// A deployment that does whatever a test needs it to.
//
// The smoke suite and wait-for-deploy.mjs both talk to a deployed environment
// over HTTP and nothing else, so the cheapest honest way to test them is to
// give them an environment. This one answers the handful of endpoints they
// ask for, and every answer can be made wrong on purpose — because the thing
// most worth proving about a health check is not that it passes against a
// healthy system, it is that it fails against a broken one.
//
// Listens on 127.0.0.1 on a port the OS picks, so runs do not collide.
//
// Every request is recorded. That is not for debugging: the suite's defining
// claim is that it writes nothing, which is what allows it to be pointed at
// production at all, and the record is how that claim gets checked rather than
// trusted.

import http from "node:http";

export const STUB_COMMIT = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
export const STUB_OLD_COMMIT = "99887766554433221100ffeeddccbbaa99887766";
export const STUB_EMAIL = "smoke@example.invalid";
// Deliberately not the throwaway password the suite uses for its
// unknown-account check: if the two matched, a suite that muddled the two
// sign-ins would still pass.
export const STUB_PASSWORD = "stub-viewer-password-4f2a";

const ACCESS_TOKEN = "stub-access-token";
const REFRESH_COOKIE = "fsr_refresh=stub-refresh-token";

const DEFAULTS = {
  // What /api/health reports. An array cycles, one entry per request, which is
  // how an origin mid-rollout is simulated.
  commit: STUB_COMMIT,
  // What the HTML stamps. Defaults to whatever the API reports; an array
  // cycles the same way. The two deploy independently in reality, so they are
  // configured independently here.
  htmlCommit: undefined,
  environment: "staging",
  service: "fire-safety-records-api",

  // Health reachability, for the "the API is down" case.
  healthStatus: 200,

  // An API-only origin (Render, Vercel) serves no HTML of ours. false makes
  // this stub one of those.
  serveHtml: true,
  // Serves HTML, but without the commit stamp — an API host with a landing
  // page, which must not be mistaken for a frontend that disagrees.
  stampCommit: true,

  credentials: { email: STUB_EMAIL, password: STUB_PASSWORD },
  cookieAttributes: "Path=/; HttpOnly; Secure; SameSite=Strict",
  // false for the case where sign-in succeeds but hands back no session at all.
  setRefreshCookie: true,

  // The faults. Each is the shape of a real regression: access control that
  // stopped being enforced, a session cookie that lost a flag.
  unauthenticatedPremisesStatus: 401,
  viewerAuditLogStatus: 403,
  complianceSummaryStatus: 200,
  logoutStatus: 204,
};

// One handler per route, each answering a single question about the
// deployment, rather than one dispatcher carrying every fault in its own
// branch. `ctx` is `{ config, authorised, counters }`; `counters` is the
// mutable `{ apiHits, htmlHits }` a stub instance owns, so a cycling answer
// (an origin mid-rollout) advances once per request rather than per route.
const ROUTES = {
  "/api/health": (req, res, ctx) => {
    const { config, counters } = ctx;
    if (config.healthStatus !== 200) return json(res, config.healthStatus, { error: "down" });
    return json(res, 200, {
      status: "ok",
      service: config.service,
      environment: config.environment,
      commit: cycle(config.commit, counters.apiHits++),
    });
  },

  "/": (req, res, ctx) => {
    const { config, counters } = ctx;
    if (!config.serveHtml) return json(res, 404, { error: "no frontend here" });
    const commit = cycle(config.htmlCommit ?? config.commit, counters.htmlHits++);
    return html(res, page(commit, config.stampCommit));
  },

  "/api/": (req, res, ctx) => {
    if (!ctx.authorised) return json(res, 401, { error: "unauthorised" });
    return json(res, 200, { data: { resources: ["premises", "assessments", "users"] } });
  },

  "/api/premises": (req, res, ctx) => {
    const { config, authorised } = ctx;
    if (authorised) return json(res, 200, { data: [{ id: 1, name: "A premises" }] });
    // The fault worth proving the suite catches: records handed to a request
    // carrying no token at all.
    return config.unauthenticatedPremisesStatus === 200
      ? json(res, 200, { data: [{ id: 1, name: "Disclosed without a token" }] })
      : json(res, config.unauthenticatedPremisesStatus, { error: "unauthorised" });
  },

  "/api/premises/compliance-summary": (req, res, ctx) => {
    const { config, authorised } = ctx;
    if (!authorised) return json(res, 401, { error: "unauthorised" });
    return config.complianceSummaryStatus === 200
      ? json(res, 200, { data: { compliant: 1, overdue: 0 } })
      : json(res, config.complianceSummaryStatus, { error: "the summary query failed" });
  },

  "/api/users/audit/log": (req, res, ctx) => {
    const { config, authorised } = ctx;
    if (!authorised) return json(res, 401, { error: "unauthorised" });
    // A viewer reaching this is role enforcement having quietly lapsed.
    return config.viewerAuditLogStatus === 200
      ? json(res, 200, { data: [{ id: 1, action: "should not be visible to a viewer" }] })
      : json(res, config.viewerAuditLogStatus, { error: "forbidden" });
  },

  "/api/auth/login": (req, res, ctx) => readBody(req, (body) => signIn(res, ctx.config, body)),

  "/api/auth/logout": (req, res, ctx) => {
    res.writeHead(ctx.config.logoutStatus).end();
  },
};

function signIn(res, config, body) {
  const { email, password } = body ?? {};
  if (email !== config.credentials.email || password !== config.credentials.password) {
    return json(res, 401, { error: "invalid credentials" });
  }
  const headers = {};
  if (config.setRefreshCookie) {
    headers["set-cookie"] = [REFRESH_COOKIE, config.cookieAttributes].filter(Boolean).join("; ");
  }
  return json(res, 200, { data: { accessToken: ACCESS_TOKEN } }, headers);
}

function cycle(value, n) {
  return Array.isArray(value) ? value[n % value.length] : value;
}

export async function startStubOrigin(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const requests = [];
  const counters = { apiHits: 0, htmlHits: 0 };

  const server = http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");
    const authorised = req.headers.authorization === `Bearer ${ACCESS_TOKEN}`;

    // Whether the request carried a token is recorded as well as the path,
    // because "how many times was this asked unauthenticated" is how the
    // no-retry rule gets checked.
    requests.push({
      method: req.method,
      path: pathname,
      search: searchParams.toString(),
      authorised,
    });

    const route = ROUTES[pathname];
    if (!route) return json(res, 404, { error: `no stub route for ${pathname}` });
    return route(req, res, { config, authorised, counters });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    // Every request that was not a GET. The suite is allowed exactly two.
    writes: () => requests.filter((request) => request.method !== "GET"),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

function page(commit, stamped) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    stamped ? `    <meta name="app-commit" content="${commit}" />` : "",
    "    <title>Fire Safety Records</title>",
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    '    <script type="module" src="/assets/index.js"></script>',
    "  </body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}

function json(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function html(res, text) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, done) {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    try {
      done(raw ? JSON.parse(raw) : null);
    } catch {
      done(null);
    }
  });
}
