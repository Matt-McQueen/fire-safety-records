// Tests for the gate that decides a deploy has landed.
//
// wait-for-deploy.mjs is run as a real process against a stub origin, rather
// than having its internals imported: the exit code *is* the interface. CI
// gates the smoke suite on it, so "returns the wrong answer" and "returns the
// right answer with the wrong exit code" are the same outage, and only running
// the script catches the second.
//
// Everything is driven with a sub-second --interval, so the whole file runs in
// a few seconds rather than the minutes a real rollout is given.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStubOrigin, STUB_COMMIT, STUB_OLD_COMMIT } from "./stub-origin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "wait-for-deploy.mjs");

// The real defaults are a ten second interval and a ten minute timeout, which
// is right for a rollout and impossible for a test.
//
// Two settings rather than one, because the deadline means opposite things
// depending on which answer the test is after. A test expecting the gate to
// give up wants the shortest deadline that still exercises the loop. A test
// expecting it to succeed wants one it will never come near: a busy runner
// that takes a second longer than this machine should make a test slower, not
// red.
const GIVES_UP = ["--interval", "0.05", "--timeout", "1"];
const SUCCEEDS = ["--interval", "0.05", "--timeout", "10"];

function runGate(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
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

async function stub(t, options) {
  const origin = await startStubOrigin(options);
  t.after(() => origin.close());
  return origin;
}

test("an origin already serving the commit is accepted", async (t) => {
  const origin = await stub(t, { commit: STUB_COMMIT });

  const { code, stdout } = await runGate(["--url", origin.url, "--commit", STUB_COMMIT, ...SUCCEEDS]);

  assert.equal(code, 0, `expected success, got ${code}`);
  assert.match(stdout, /is serving .* \(3 consecutive checks\)/);
  assert.match(stdout, /every origin agreed 3 times running/);
});

test("a short SHA is accepted against a deployment reporting the full one", async (t) => {
  // The workflow passes github.sha, but a person at a terminal passes whatever
  // git rev-parse --short HEAD gave them, and both are the same commit.
  const origin = await stub(t, { commit: STUB_COMMIT });

  const { code } = await runGate([
    "--url",
    origin.url,
    "--commit",
    STUB_COMMIT.slice(0, 7),
    ...SUCCEEDS,
  ]);

  assert.equal(code, 0);
});

test("an origin that flaps between builds is never accepted", async (t) => {
  // This is the bug #11 fixed, kept honest. A rollout in progress answers from
  // whichever edge node caught the request, so the origin genuinely alternates
  // between the new build and the old one. Declaring it ready on the strength
  // of a request that happened to hit a fresh node is how the gate once waved
  // the suite at a frontend still serving the previous commit.
  const origin = await stub(t, {
    commit: STUB_COMMIT,
    htmlCommit: [STUB_COMMIT, STUB_OLD_COMMIT],
  });

  const { code, stdout, stderr } = await runGate([
    "--url",
    origin.url,
    "--commit",
    STUB_COMMIT,
    ...GIVES_UP,
  ]);

  assert.equal(code, 1, "a flapping origin was accepted as ready");
  assert.match(stderr, /Gave up after 1s/);
  // It saw the flap rather than simply never getting a good answer: the count
  // reached one and was thrown away, repeatedly. Which phase of the alternation
  // the final probe lands in is luck, so the run's last reported reason is not
  // worth asserting on — that it kept starting again is.
  assert.match(stdout, /disagreed after 1 confirmation\(s\)/);
});

test("one lucky probe would have accepted that same flapping origin", async (t) => {
  // The other half of the same proof, and the reason --confirmations exists:
  // the origin above is not broken in a way a single request can see. Asking
  // once says yes about half the time. This is what the gate used to do.
  const origin = await stub(t, {
    commit: STUB_COMMIT,
    htmlCommit: [STUB_COMMIT, STUB_OLD_COMMIT],
  });

  const { code } = await runGate([
    "--url",
    origin.url,
    "--commit",
    STUB_COMMIT,
    "--confirmations",
    "1",
    ...SUCCEEDS,
  ]);

  assert.equal(code, 0, "the premise of this test is wrong if one probe also fails");
});

test("the confirmation count starts again when an origin disagrees", async (t) => {
  // Two agreements, a disagreement, then three: only the last three count, and
  // the run must take the long way round rather than adding up to five.
  const origin = await stub(t, {
    commit: STUB_COMMIT,
    htmlCommit: [
      STUB_COMMIT,
      STUB_COMMIT,
      STUB_OLD_COMMIT,
      STUB_COMMIT,
      STUB_COMMIT,
      STUB_COMMIT,
    ],
  });

  const { code, stdout } = await runGate([
    "--url",
    origin.url,
    "--commit",
    STUB_COMMIT,
    ...SUCCEEDS,
  ]);

  assert.equal(code, 0);
  assert.match(stdout, /disagreed after 2 confirmation\(s\)/);
});

test("an origin serving no frontend of ours is judged on /api/health alone", async (t) => {
  // Render and Vercel serve the API and nothing else. There is no HTML to
  // disagree with, and waiting for a stamp that will never appear would hang
  // the gate on a perfectly healthy origin.
  const origin = await stub(t, { commit: STUB_COMMIT, serveHtml: false });

  const { code } = await runGate(["--url", origin.url, "--commit", STUB_COMMIT, ...SUCCEEDS]);

  assert.equal(code, 0);
});

test("an origin serving HTML with no commit stamp is treated the same way", async (t) => {
  // An API host with a landing page. Unstamped means "not our frontend", which
  // is not the same as "our frontend, reporting the wrong commit".
  const origin = await stub(t, { commit: STUB_COMMIT, stampCommit: false });

  const { code } = await runGate(["--url", origin.url, "--commit", STUB_COMMIT, ...SUCCEEDS]);

  assert.equal(code, 0);
});

test("an origin still serving the previous build is given up on", async (t) => {
  const origin = await stub(t, { commit: STUB_OLD_COMMIT });

  const { code, stderr } = await runGate(["--url", origin.url, "--commit", STUB_COMMIT, ...GIVES_UP]);

  assert.equal(code, 1);
  assert.match(stderr, /Still waiting on:/);
  assert.match(stderr, new RegExp(`API reports ${STUB_OLD_COMMIT}`));
  // The message has to send someone to the deploy log rather than to this
  // script: a build that failed serves the old commit forever, and the gate is
  // the part that looks broken.
  assert.match(stderr, /deploy log/);
});

test("an origin that cannot be reached is given up on, saying so", async (t) => {
  const origin = await stub(t, { healthStatus: 503 });

  const { code, stderr } = await runGate(["--url", origin.url, "--commit", STUB_COMMIT, ...GIVES_UP]);

  assert.equal(code, 1);
  assert.match(stderr, /GET \/api\/health returned 503/);
});

test("every origin has to agree, not just the first one", async (t) => {
  const ready = await stub(t, { commit: STUB_COMMIT });
  const behind = await stub(t, { commit: STUB_OLD_COMMIT });

  const { code, stderr } = await runGate([
    "--url",
    ready.url,
    "--url",
    behind.url,
    "--commit",
    STUB_COMMIT,
    ...GIVES_UP,
  ]);

  assert.equal(code, 1, "one ready origin released the gate while another was behind");
  assert.match(stderr, new RegExp(escapeForRegExp(behind.url)));
  assert.doesNotMatch(stderr, new RegExp(escapeForRegExp(ready.url)));
});

test("a trailing slash on the URL does not produce a doubled path", async (t) => {
  const origin = await stub(t, { commit: STUB_COMMIT });

  const { code } = await runGate(["--url", `${origin.url}/`, "--commit", STUB_COMMIT, ...SUCCEEDS]);

  assert.equal(code, 0);
  assert.ok(
    origin.requests.every((request) => !request.path.startsWith("//")),
    "the origin was asked for a doubled path",
  );
});

test("missing arguments exit 2 rather than waiting for nothing", async () => {
  // Distinct from 1 on purpose: a workflow that mistyped a variable should be
  // told it is misconfigured, not told the deploy never landed.
  const noArgs = await runGate([]);
  assert.equal(noArgs.code, 2);
  assert.match(noArgs.stderr, /usage: node wait-for-deploy\.mjs/);

  const noCommit = await runGate(["--url", "http://127.0.0.1:1"]);
  assert.equal(noCommit.code, 2);

  const noUrl = await runGate(["--commit", STUB_COMMIT]);
  assert.equal(noUrl.code, 2);
});

test("a --url flag left empty is a misconfiguration, not an origin", async () => {
  // --url $SMOKE_API_URL with the variable unset leaves the flag bare. It must
  // not silently swallow the next flag as its value and wait on nonsense.
  const { code, stderr } = await runGate(["--url", "--commit", STUB_COMMIT, ...GIVES_UP]);

  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0, "nothing was said about an empty --url");
});

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
