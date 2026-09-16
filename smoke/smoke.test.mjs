// Smoke tests for a deployed environment — the only suite that may be pointed
// at production.
//
// The distinction from backend/tests and e2e/ is not thoroughness, it is
// consequence. Those two create premises, people and accounts directly in the
// database and delete them afterwards; run either against production and a
// crashed process or a lost connection leaves real-looking records behind, in
// a database that holds personal data. Nothing here writes anything. Every
// request is a GET, apart from the sign-in that the authorised checks need and
// the sign-out that gives the session back at the end.
//
// What it is for: confirming that the environment a deploy just landed on is
// actually serving that build, that the pieces are wired to each other, and
// that the access controls are still in force. It is a deployment check, not a
// test of the business rules — those are proved before anything is promoted.
//
// Configuration, all through the environment:
//
//   SMOKE_WEB_URL      required. The public origin, e.g.
//                      https://fire-safety-records.pages.dev. Everything is
//                      driven through this rather than the API's own hostname,
//                      because it is the path a real user takes: the Pages
//                      function proxying /api/* is part of what has to work.
//   SMOKE_API_URL      optional. The API's own origin (Render, Vercel). When
//                      set, its health is checked directly too, which
//                      separates "the API is down" from "the proxy in front of
//                      it is misconfigured".
//   SMOKE_EMAIL        optional, with SMOKE_PASSWORD. A viewer-role account.
//   SMOKE_PASSWORD     Without them the signed-in checks skip rather than fail,
//                      and roughly half the value of the suite goes with them.
//   SMOKE_COMMIT       optional. The commit this deploy was meant to be. When
//                      set, the frontend must report it, and the API must
//                      report either it or a commit it is still right to be
//                      serving — Render builds only from backend/, so a
//                      promotion that changes nothing there moves the frontend
//                      and correctly leaves the API where it was. See
//                      deploy-scope.mjs, which draws that line. What this
//                      stops, either way, is a suite passing against the build
//                      it was supposed to replace.
//   SMOKE_ENVIRONMENT  optional. "production" or "staging"; the API must agree.
//                      Worth setting for production runs: it is the check that
//                      catches a URL pointed at the wrong environment.

import test from "node:test";
import assert from "node:assert/strict";
import { judgeApiCommit, commitMatches } from "./deploy-scope.mjs";

const webUrl = trimSlash(process.env.SMOKE_WEB_URL);
const apiUrl = trimSlash(process.env.SMOKE_API_URL);
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const expectedCommit = process.env.SMOKE_COMMIT?.trim();
const expectedEnvironment = process.env.SMOKE_ENVIRONMENT?.trim();

// How long the two commit assertions keep retrying before believing a wrong
// answer. Configurable only so that the tests in tests/ can exercise the
// failing path in a moment rather than a minute; left unset — which is every
// real run — it is the minute it has always been.
const settleSeconds = Number(process.env.SMOKE_SETTLE_SECONDS ?? 60);

if (!webUrl) {
  console.error("SMOKE_WEB_URL is not set. See smoke/README.md.");
  process.exit(1);
}

// Skipping is deliberate rather than a failure: a freshly created environment
// may not have a smoke account yet, and a suite that cannot run at all is
// worse than one that says which half of it ran. CI names the skip in its
// output, so a permanently half-run suite is visible rather than quiet.
const skipUnauthenticated =
  email && password
    ? false
    : "SMOKE_EMAIL and SMOKE_PASSWORD are not set, so the signed-in checks cannot run";

function trimSlash(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Compared by prefix, so a short SHA works as the expected value.
// Retries a check for a while before believing it.
//
// A rollout reaches edge nodes at different moments, so a single request can be
// answered by one that has not caught up yet. That is not a failure, it is a
// rollout in progress — and telling the two apart is the difference between a
// check that means something and one that cries wolf. Only the commit checks
// use this: everything else here is asserting behaviour, where one wrong answer
// is one too many.
async function settles(check, { seconds = settleSeconds, every = Math.min(5, seconds / 4) } = {}) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  while (true) {
    last = await check();
    if (last.ok) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, every * 1000));
  }
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers, text };
}

// --- the deployment is up, and is the build we think it is ------------------

test("the API answers through the public origin", async () => {
  const { status, body } = await getJson(`${webUrl}/api/health`);
  assert.equal(status, 200, `GET ${webUrl}/api/health returned ${status}`);
  assert.equal(body?.status, "ok");
  assert.equal(body?.service, "fire-safety-records-api");
});

test(
  "the API answers on its own origin",
  { skip: apiUrl ? false : "SMOKE_API_URL is not set" },
  async () => {
    const { status, body } = await getJson(`${apiUrl}/api/health`);
    assert.equal(status, 200, `GET ${apiUrl}/api/health returned ${status}`);
    assert.equal(body?.status, "ok");
  },
);

test(
  "the API is the environment this run is aimed at",
  { skip: expectedEnvironment ? false : "SMOKE_ENVIRONMENT is not set" },
  async () => {
    const { body } = await getJson(`${webUrl}/api/health`);
    assert.equal(
      body?.environment,
      expectedEnvironment,
      `expected the ${expectedEnvironment} API, got ${body?.environment}`,
    );
  },
);

test(
  "the API is running the commit it should be",
  { skip: expectedCommit ? false : "SMOKE_COMMIT is not set" },
  async () => {
    // Deliberately not "the commit being tested". Render builds only from
    // backend/, so a promotion that changes nothing there leaves the API on an
    // older commit and correct; deploy-scope.mjs is what separates that from a
    // deploy that failed. Asserting plain equality here failed two healthy
    // promotions in a row.
    const result = await settles(async () => {
      const { body } = await getJson(`${webUrl}/api/health`);
      const verdict = judgeApiCommit(body?.commit, expectedCommit);
      return { ok: verdict.ok, seen: verdict.reason, excused: verdict.excused };
    });
    assert.ok(
      result.ok,
      `the API ${result.seen}, after a minute of asking. Expected ${expectedCommit}. ` +
        "The deploy has probably not finished; see smoke/wait-for-deploy.mjs.",
    );
    if (result.excused) console.log(`    # the API ${result.seen}`);
  },
);

test("the frontend is served", async () => {
  const response = await fetch(webUrl);
  assert.equal(response.status, 200, `GET ${webUrl} returned ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);

  const html = await response.text();
  assert.match(html, /<div id="root">/, "the app's mount point is missing from the served HTML");
  assert.match(html, /<script type="module"/, "the built bundle is not referenced");
});

test(
  "the frontend is the commit being tested",
  { skip: expectedCommit ? false : "SMOKE_COMMIT is not set" },
  async () => {
    // The one most worth retrying. Pages serves from many edge nodes and they do
    // not switch together, so two requests a second apart can disagree - which
    // is exactly how this assertion failed once while wait-for-deploy.mjs had
    // just declared the same origin ready.
    const result = await settles(async () => {
      const html = await (await fetch(webUrl)).text();
      const reported = html.match(/<meta name="app-commit" content="([^"]*)"/)?.[1];
      return { ok: commitMatches(reported, expectedCommit), seen: reported || "(none)" };
    });
    assert.ok(
      result.ok,
      `the frontend still reports commit ${result.seen} after a minute, expected ${expectedCommit}. ` +
        "Pages deploys separately from the API, so the two can legitimately differ " +
        "for a minute — and must not still differ once both have finished.",
    );
  },
);

// --- the access controls are still in force ---------------------------------

test("records cannot be read without a token", async () => {
  const { status, body } = await getJson(`${webUrl}/api/premises`);
  assert.equal(status, 401, `unauthenticated GET /api/premises returned ${status}`);
  assert.ok(!body?.data, "an unauthenticated request came back with data");
});

test("the audit log cannot be read without a token", async () => {
  const { status } = await getJson(`${webUrl}/api/users/audit/log`);
  assert.equal(status, 401);
});

test("a forged token is refused", async () => {
  // alg:none with an empty signature — the classic JWT forgery, and the one
  // thing an access-control check can try without an account of any kind.
  //
  // Checked here because backend/tests cannot check it against staging: Vercel
  // refuses this shape at its own edge, so the assertion there would read the
  // platform rather than the app. This one is deliberately satisfied by either
  // — a refusal from the edge and a refusal from the app are both a refusal,
  // and what a deployment check is for is proving that nothing was served. On
  // production, where the API is a long-lived process with no such edge in
  // front of it, the refusal is the app's own 401.
  const forged = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
    sub: "1",
    email: "forged@example.invalid",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;

  const { status, body } = await getJson(`${webUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${forged}` },
  });
  assert.ok(
    status === 401 || status === 403,
    `a request carrying an unsigned token returned ${status}, not a refusal`,
  );
  assert.ok(!body?.data, "an unsigned token came back with data");
});

test("an unknown account cannot sign in", async () => {
  // Deliberately an address that cannot exist, rather than a real account with
  // the wrong password: failed attempts lock the account they are aimed at,
  // and locking a real user out for fifteen minutes is not something a health
  // check should be able to do.
  const { status, body } = await getJson(`${webUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "smoke-check-no-such-account@example.invalid",
      password: "not-a-real-password-000000",
    }),
  });
  assert.equal(status, 401, `a sign-in with unknown credentials returned ${status}`);
  assert.ok(!body?.data?.accessToken, "a token was issued for an account that does not exist");
});

// --- signed in, still read only ---------------------------------------------

test("a signed-in viewer can read, and only read", { skip: skipUnauthenticated }, async (t) => {
  let accessToken;
  let refreshCookie;

  await t.test("sign in", async () => {
    const response = await fetch(`${webUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, `sign-in returned ${response.status}`);
    accessToken = body?.data?.accessToken;
    assert.ok(accessToken, "no access token in the sign-in response");

    // The refresh cookie is the session. These flags are configuration, and a
    // local run cannot catch them being wrong: a Secure cookie is not sent
    // over plain HTTP in the first place, so only a deployed check sees this.
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("fsr_refresh="));
    assert.ok(cookie, "sign-in set no refresh cookie");
    assert.match(cookie, /HttpOnly/i, "the refresh cookie is readable from JavaScript");
    assert.match(cookie, /Secure/i, "the refresh cookie is not marked Secure");
    assert.match(cookie, /SameSite=Strict/i, "the refresh cookie is not SameSite=Strict");
    refreshCookie = cookie.split(";")[0];
  });

  const authorised = (path) =>
    getJson(`${webUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });

  await t.test("the endpoint index is served", async () => {
    const { status, body } = await authorised("/api/");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.data?.resources), "the index lists no resources");
    assert.ok(body.data.resources.length > 0);
  });

  await t.test("premises can be listed", async () => {
    const { status, body } = await authorised("/api/premises?limit=1");
    assert.equal(status, 200, `GET /api/premises returned ${status}`);
    assert.ok(Array.isArray(body?.data), "the premises list is not an array");
  });

  await t.test("the compliance summary is computed", async () => {
    // The one read that goes beyond a single table: it joins across
    // assessments, checks and schedules, so a missing migration or a broken
    // view surfaces here rather than at a user's first page load.
    const { status, body } = await authorised("/api/premises/compliance-summary");
    assert.equal(status, 200, `GET /api/premises/compliance-summary returned ${status}`);
    assert.ok(body?.data !== undefined, "the compliance summary returned no data");
  });

  await t.test("a viewer is refused the audit log", async () => {
    // Read-only proof that role enforcement survived the deploy. Checked with
    // a GET that an admin would be allowed, rather than a write a viewer is
    // not: a write that wrongly succeeded would leave a record behind.
    const { status } = await authorised("/api/users/audit/log");
    assert.equal(status, 403, `a viewer got ${status} from the admin-only audit log`);
  });

  await t.test("sign out", async () => {
    // Hands the session back, rather than leaving a refresh token sitting in
    // the database until it expires.
    const response = await fetch(`${webUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: refreshCookie },
    });
    assert.equal(response.status, 204, `sign-out returned ${response.status}`);
  });
});
