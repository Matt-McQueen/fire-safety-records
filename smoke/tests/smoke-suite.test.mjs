// Tests for the smoke suite itself.
//
// The point of these is not that the suite passes against a healthy stub. It
// is that it fails against a broken one. A smoke suite that cannot go red is
// worse than having none at all, because a green tick from it is the last
// thing standing between a bad build and production, and everyone believes it.
//
// So most of what follows breaks the deployment on purpose, one fault at a
// time, and asserts that the suite notices and names the right check. Each
// fault is the shape of something that has actually gone wrong somewhere:
// access control that stopped being enforced, a session cookie that lost a
// flag in a config change, a deploy that never landed.
//
// The suite is run as a child process, the way CI runs it, so its exit code
// and its output are both part of what is being checked.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  startStubOrigin,
  STUB_COMMIT,
  STUB_OLD_COMMIT,
  STUB_EMAIL,
  STUB_PASSWORD,
} from "./stub-origin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteDir = path.join(here, "..");

// A second, rather than the minute a real run allows. Only the two commit
// assertions consult it, and only when they are failing.
const QUICK_SETTLE = "1";

function runSuite(env = {}) {
  return new Promise((resolve, reject) => {
    // TAP explicitly, rather than whatever node:test picks by default. The
    // default depends on whether stdout is a terminal and has changed between
    // Node versions, and these assertions read the child's output.
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", "smoke.test.mjs"], {
      cwd: suiteDir,
      env: { ...childEnv(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// Two things have to come out of the inherited environment before a nested
// test run means anything.
//
// Every SMOKE_* variable, because a developer with real staging credentials
// exported should get the same answer from these tests as CI does, and should
// certainly not have the suite quietly pointed at staging by one of them.
//
// And NODE_TEST_CONTEXT, which node:test sets on the processes it spawns to
// tell them they are already inside a run. Handing it to a child that is
// itself `node --test` makes that child report into a harness that is not
// listening and exit 0 whatever happened inside it — so every assertion below
// passed, against a deployment that was broken on purpose, until this was
// taken out.
function childEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("SMOKE_") && key !== "NODE_TEST_CONTEXT",
    ),
  );
}

const healthyEnv = (origin) => ({
  SMOKE_WEB_URL: origin.url,
  SMOKE_EMAIL: STUB_EMAIL,
  SMOKE_PASSWORD: STUB_PASSWORD,
  SMOKE_COMMIT: STUB_COMMIT,
  SMOKE_ENVIRONMENT: "staging",
  SMOKE_SETTLE_SECONDS: QUICK_SETTLE,
});

async function stub(t, options) {
  const origin = await startStubOrigin(options);
  t.after(() => origin.close());
  return origin;
}

// A deployment with one thing wrong with it, and the check that should say so.
async function expectRed(t, faults, expectedCheck) {
  const origin = await stub(t, faults);
  const { code, stdout } = await runSuite(healthyEnv(origin));

  assert.notEqual(code, 0, `the suite passed against a deployment where ${expectedCheck}`);
  assert.match(stdout, new RegExp(`not ok .*${expectedCheck}`));
  return { origin, stdout };
}

// --- the suite passes when it should ----------------------------------------

test("a healthy deployment passes every check", async (t) => {
  const origin = await stub(t, { commit: STUB_COMMIT, environment: "staging" });

  const { code, stdout } = await runSuite({
    ...healthyEnv(origin),
    // Checked on its own origin too, which is the one remaining branch.
    SMOKE_API_URL: origin.url,
  });

  assert.equal(code, 0, `a healthy deployment failed the suite:\n${stdout}`);
  assert.match(stdout, /# fail 0/);
  // Nothing skipped: with every variable set, every check should have run.
  assert.match(stdout, /# skipped 0/);
});

test("the suite writes nothing but its own sign-in and sign-out", async (t) => {
  // The property that lets this suite near production at all. backend/tests
  // and e2e/ create records and delete them afterwards, which is fine for a
  // disposable database and not fine for one holding personal data; if this
  // suite ever grows a write, it stops being safe to point at production and
  // the README stops being true.
  const origin = await stub(t, { commit: STUB_COMMIT, environment: "staging" });

  const { code } = await runSuite(healthyEnv(origin));
  assert.equal(code, 0);

  const writes = origin.writes().map((request) => `${request.method} ${request.path}`);
  assert.deepEqual(
    [...new Set(writes)].sort(),
    ["POST /api/auth/login", "POST /api/auth/logout"],
    `the suite made a request that was not a GET: ${writes.join(", ")}`,
  );
});

test("without credentials the signed-in half skips rather than fails", async (t) => {
  // A freshly created environment has no smoke account yet. Half a suite is
  // worth having; a suite that cannot run at all is not.
  const origin = await stub(t, { commit: STUB_COMMIT, environment: "staging" });

  const { code, stdout } = await runSuite({
    SMOKE_WEB_URL: origin.url,
    SMOKE_COMMIT: STUB_COMMIT,
    SMOKE_ENVIRONMENT: "staging",
    SMOKE_SETTLE_SECONDS: QUICK_SETTLE,
  });

  assert.equal(code, 0);
  assert.match(stdout, /# fail 0/);
  // And says so, loudly enough that a permanently half-run suite is visible
  // rather than quietly green.
  assert.match(stdout, /SMOKE_EMAIL and SMOKE_PASSWORD are not set/);
  assert.doesNotMatch(stdout, /# skipped 0/);
});

// --- the suite fails when it should -----------------------------------------

test("records served without a token fail the suite", async (t) => {
  // The fault the whole exercise is aimed at: authentication that has stopped
  // being applied to a list endpoint, handing records to anyone who asks.
  const { origin } = await expectRed(
    t,
    { commit: STUB_COMMIT, unauthenticatedPremisesStatus: 200 },
    "records cannot be read without a token",
  );

  // And it was asked exactly once. The commit checks retry because a rollout
  // is legitimately inconsistent for a moment; an access control is not, and
  // a 401 that arrives on the second attempt is a broken deployment, not a
  // slow one. Retrying this would turn a real failure into a flake.
  const unauthenticated = origin.requests.filter(
    (request) => request.path === "/api/premises" && !request.authorised,
  );
  assert.equal(unauthenticated.length, 1, "the unauthenticated read was retried");
});

test("a deployment that honours a forged token fails the suite", async (t) => {
  // Signature verification having quietly lapsed: the API takes the claims it
  // is handed, so anyone can mint themselves an admin. backend/tests proves the
  // app refuses this, but cannot prove it against staging — Vercel's own edge
  // intercepts the shape first — so a deployed environment is checked here.
  await expectRed(
    t,
    { commit: STUB_COMMIT, honoursForgedTokens: true },
    "a forged token is refused",
  );
});

test("an audit log open to a viewer fails the suite", async (t) => {
  await expectRed(
    t,
    { commit: STUB_COMMIT, viewerAuditLogStatus: 200 },
    "a viewer is refused the audit log",
  );
});

test("a refresh cookie that lost Secure fails the suite", async (t) => {
  // Not reachable from any local run: a Secure cookie is not sent over plain
  // HTTP in the first place, so only a deployed check ever sees this flag.
  const { stdout } = await expectRed(
    t,
    { commit: STUB_COMMIT, cookieAttributes: "Path=/; HttpOnly; SameSite=Strict" },
    "sign in",
  );
  assert.match(stdout, /not marked Secure/);
});

test("a refresh cookie that lost HttpOnly fails the suite", async (t) => {
  const { stdout } = await expectRed(
    t,
    { commit: STUB_COMMIT, cookieAttributes: "Path=/; Secure; SameSite=Strict" },
    "sign in",
  );
  assert.match(stdout, /readable from JavaScript/);
});

test("a refresh cookie relaxed to SameSite=Lax fails the suite", async (t) => {
  const { stdout } = await expectRed(
    t,
    { commit: STUB_COMMIT, cookieAttributes: "Path=/; HttpOnly; Secure; SameSite=Lax" },
    "sign in",
  );
  assert.match(stdout, /SameSite=Strict/);
});

test("a sign-in that sets no session cookie at all fails the suite", async (t) => {
  const { stdout } = await expectRed(
    t,
    { commit: STUB_COMMIT, setRefreshCookie: false },
    "sign in",
  );
  assert.match(stdout, /set no refresh cookie/);
});

test("an API still serving the previous build fails the suite", async (t) => {
  // STUB_OLD_COMMIT is not in any history this checkout has, so the exemption
  // in deploy-scope.mjs cannot reach it: an API reporting a commit nobody can
  // place is a failed deploy, and the suite still says so.
  await expectRed(
    t,
    { commit: STUB_OLD_COMMIT },
    "the API is running the commit it should be",
  );
});

test("a frontend still serving the previous build fails the suite", async (t) => {
  // Separately from the API, because Pages and Render deploy independently and
  // one landing is not the other landing. An API-only check would go green on
  // a promotion that left the frontend behind.
  await expectRed(
    t,
    { commit: STUB_COMMIT, htmlCommit: STUB_OLD_COMMIT },
    "the frontend is the commit being tested",
  );
});

test("an API that is the wrong environment fails the suite", async (t) => {
  // The check that catches a production run pointed at staging, or worse.
  await expectRed(
    t,
    { commit: STUB_COMMIT, environment: "production" },
    "the API is the environment this run is aimed at",
  );
});

test("a compliance summary that will not compute fails the suite", async (t) => {
  // The one read crossing several tables, and so the one that notices a
  // migration that did not land.
  await expectRed(
    t,
    { commit: STUB_COMMIT, complianceSummaryStatus: 500 },
    "the compliance summary is computed",
  );
});

test("a sign-out that does not return the session fails the suite", async (t) => {
  await expectRed(t, { commit: STUB_COMMIT, logoutStatus: 500 }, "sign out");
});

test("an API that is down fails the suite", async (t) => {
  await expectRed(t, { healthStatus: 503 }, "the API answers through the public origin");
});

// --- the retry that is supposed to be there ---------------------------------

test("a stale edge response on the commit check is retried rather than believed", async (t) => {
  // The other side of the no-retry rule. Pages serves from many nodes and they
  // do not switch together, so one request during a rollout can legitimately
  // come back with the previous commit. That is a rollout in progress, not a
  // failure, and failing on it would make the suite cry wolf on every deploy.
  //
  // The array is consumed one entry per request to "/": the first is the
  // "frontend is served" check, which does not look at the commit; the second
  // is the commit check finding a stale node; the third is its retry.
  const origin = await stub(t, {
    commit: STUB_COMMIT,
    htmlCommit: [STUB_COMMIT, STUB_OLD_COMMIT, STUB_COMMIT],
  });

  const { code, stdout } = await runSuite({
    ...healthyEnv(origin),
    SMOKE_SETTLE_SECONDS: "2",
  });

  assert.equal(code, 0, `a single stale response failed the suite:\n${stdout}`);
});

// --- misconfiguration --------------------------------------------------------

test("no SMOKE_WEB_URL stops the run rather than testing nothing", async () => {
  // A suite with nothing to point at must not report that nothing is wrong.
  const { code, stdout, stderr } = await runSuite({});

  assert.equal(code, 1);
  // Under `node --test` the file's own console output is captured into the TAP
  // stream rather than reaching the runner's stderr, so the message can arrive
  // on either depending on how the suite is started. Both are checked, because
  // what matters is that it is said, not which pipe it came down.
  assert.match(stdout + stderr, /SMOKE_WEB_URL is not set/);
});
