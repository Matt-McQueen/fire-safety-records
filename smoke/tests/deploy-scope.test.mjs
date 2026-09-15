// Tests for the rule that lets an origin stay on an older commit.
//
// This is the one piece of the gate that can say "yes" to a deployment that is
// not serving what was just pushed, so it is the piece most worth trying to
// fool. Every test below builds a real repository and asks git real questions
// about it, rather than stubbing the answers: the interesting failures here
// are things like a shallow clone or an unknown commit, and a stub that always
// answers cannot produce them.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { judgeApiCommit, apiBuildPaths } from "../deploy-scope.mjs";
import { buildRepo } from "./temp-repo.mjs";

test("an API serving the promoted commit is simply right", async (t) => {
  const repo = buildRepo(t);
  const verdict = judgeApiCommit(repo.rootOnlyChange, repo.rootOnlyChange);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.excused, undefined, "an exact match should not need excusing");
});

test("a short SHA still matches the full one", async (t) => {
  const repo = buildRepo(t);
  assert.equal(judgeApiCommit(repo.rootOnlyChange.slice(0, 7), repo.rootOnlyChange).ok, true);
});

test("an older commit is accepted when nothing under backend/ has changed since", async (t) => {
  const repo = buildRepo(t);

  // The case this whole module exists for: the promotion added CLAUDE.md and
  // touched a README, so Render had no reason to build and the API is right
  // where it was.
  const verdict = judgeApiCommit(repo.backendChange, repo.rootOnlyChange);

  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.excused, true, "the pass should declare itself an exemption");
  assert.match(verdict.reason, /nothing under backend\/ has changed/);
});

test("an older commit is refused when backend/ has changed since", async (t) => {
  const repo = buildRepo(t);

  // Same shape, opposite answer: this is a deploy that was owed and did not
  // happen, which is the thing the gate is for.
  const verdict = judgeApiCommit(repo.first, repo.rootOnlyChange);

  assert.equal(verdict.ok, false, "a missed rebuild was excused");
  assert.match(verdict.reason, /a rebuild is owed/);
});

test("a commit from a line that was never promoted is refused", async (t) => {
  const repo = buildRepo(t);

  // Not an ancestor. Nothing under backend/ differs between the two, so a
  // check that only compared paths would wave this through — and an API
  // serving a commit that is not in the history being promoted is a deploy
  // from somewhere nobody intended.
  const verdict = judgeApiCommit(repo.sideways, repo.rootOnlyChange);

  assert.equal(verdict.ok, false, "a commit off the promoted line was excused");
  assert.match(verdict.reason, /not an ancestor/);
});

test("a commit the checkout has never heard of is refused", async (t) => {
  const repo = buildRepo(t);

  // What a shallow clone looks like from in here: git cannot answer, so the
  // answer is no.
  const verdict = judgeApiCommit("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", repo.rootOnlyChange);

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /not an ancestor/);
});

test("an API reporting no commit at all is refused", async (t) => {
  const repo = buildRepo(t);
  assert.equal(judgeApiCommit(null, repo.rootOnlyChange).ok, false);
  assert.equal(judgeApiCommit(undefined, repo.rootOnlyChange).ok, false);
});

test("the build paths come from render.yaml, so the two cannot drift", async (t) => {
  const repo = buildRepo(t, { rootDir: "service" });

  assert.deepEqual(apiBuildPaths(), ["service/"]);

  // backend/ is no longer what the API builds from, so a backend-only change
  // stops being a reason to wait.
  const verdict = judgeApiCommit(repo.first, repo.rootOnlyChange);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.excused, true);
});

test("a blueprint that cannot be read excuses nothing", async (t) => {
  const repo = buildRepo(t);
  fs.rmSync(path.join(repo.dir, "render.yaml"));

  assert.equal(apiBuildPaths(), null);

  // Failing closed: without knowing what the API builds from, the only safe
  // answer to "should it have rebuilt" is "assume so and keep waiting".
  const verdict = judgeApiCommit(repo.backendChange, repo.rootOnlyChange);
  assert.equal(verdict.ok, false, "an unreadable blueprint granted an exemption");
  assert.match(verdict.reason, /did not yield a rootDir/);
});

test("a blueprint with more than one rootDir excuses nothing", async (t) => {
  const repo = buildRepo(t);
  fs.writeFileSync(
    path.join(repo.dir, "render.yaml"),
    "services:\n  - type: web\n    rootDir: backend\n  - type: worker\n    rootDir: jobs\n",
  );

  // Two services means two things that deploy on their own schedules, and this
  // module was written for one. Guessing which origin is which is not worth
  // the downside, so it stops guessing.
  assert.equal(apiBuildPaths(), null);
  assert.equal(judgeApiCommit(repo.backendChange, repo.rootOnlyChange).ok, false);
});

test("no expected commit means nothing to judge", async (t) => {
  buildRepo(t);

  // SMOKE_COMMIT is optional, and an unset one is not a failure — it is a run
  // that was never asked to check which build it was talking to.
  assert.equal(judgeApiCommit("whatever", undefined).ok, true);
  assert.equal(judgeApiCommit("whatever", "").ok, true);
});
