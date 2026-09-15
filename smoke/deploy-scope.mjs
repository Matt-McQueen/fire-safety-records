// Which parts of a deployment a given commit can actually move.
//
// The gate in front of production used to assume that every push to main
// produces a new build on every origin. It does not. Render's blueprint sets
// `rootDir: backend`, and Render does not rebuild when a commit changes
// nothing under that directory — so promoting a change to `e2e/`, to CI, or to
// a file at the repository root leaves the API correctly serving the last
// commit that did touch `backend/`, for as long as that remains true.
//
// Before this module existed, wait-for-deploy.mjs waited for that API to start
// reporting a commit it was never going to be built from, gave up after ten
// minutes, and failed the Smoke workflow. That happened on two consecutive
// promotions. The cost is not the wasted ten minutes: it is that a red Smoke
// run on main stopped meaning "production is wrong" and started meaning "one
// of two things, and you will have to go and find out which". A gate that
// cries wolf is how the real wolf gets in.
//
// So the question this answers is not "is the API serving the commit we
// pushed" but "is the API serving a commit it should still be serving".
//
// Two rules, and the second is the whole point:
//
//   1. If it reports the commit being promoted, it is right. Nothing else to
//      check.
//   2. If it reports something else, that is only acceptable when the
//      something else is an *ancestor* of the commit being promoted and
//      nothing under the API's build paths changed in between. An older
//      commit off to one side of history, or an older commit with backend
//      changes since, is a deploy that failed or never ran — which is exactly
//      what this gate exists to catch, and is still caught.
//
// Everything here fails closed. If git cannot answer — no checkout, a shallow
// clone without the older commit, no git at all — no exemption is granted and
// the caller waits and then fails, which is the behaviour it had before. The
// failure mode of being too strict is a red build on a healthy deployment; the
// failure mode of being too lax is a broken production that reports itself
// well. Only one of those is recoverable by reading the log.
//
// The frontend gets no equivalent exemption, deliberately. Cloudflare Pages
// builds every commit on the branch it tracks regardless of which files
// changed — the promotion that prompted all this touched one Markdown file at
// the repository root and Pages redeployed for it. So a frontend still serving
// an older commit has no innocent explanation, and is treated as it always
// was.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The checkout to ask about history. Overridable only so that the tests in
// tests/ can point this at a small repository built for the purpose; every
// real run leaves it unset and gets the checkout this file lives in. Read per
// call rather than once at import, so a test can hold two repositories in one
// process without the order of its imports deciding which one it gets.
function repoRoot() {
  return process.env.SMOKE_REPO_ROOT || path.join(here, "..");
}

// Eight branches, each returning a different verdict with a different reason,
// and the order they are asked in is the safety property: ancestry before
// paths, because a commit that is not in this history must not be excused by
// what happens to have changed in it. Splitting that into helpers would move
// the branching somewhere else and make the sequence harder to audit as one
// piece, which is the only reason to read this function at all. fallow flags
// it on CRAP alone — cyclomatic 8 against a threshold of 20 — and CRAP assumes
// no coverage, which here is wrong by the eleven tests in
// tests/deploy-scope.test.mjs.
// fallow-ignore-next-line complexity
export function judgeApiCommit(reported, expected, git = gitIn(repoRoot())) {
  if (!expected) return { ok: true, reason: "no commit was named to check against" };
  if (!reported) return { ok: false, reason: "no commit reported" };
  if (commitMatches(reported, expected)) {
    return { ok: true, reason: `serving ${expected}` };
  }

  const paths = apiBuildPaths();
  if (paths === null) {
    return {
      ok: false,
      reason: `reports ${reported}, and render.yaml did not yield a rootDir to judge that against`,
    };
  }

  if (!git.isAncestor(reported, expected)) {
    return {
      ok: false,
      reason: `reports ${reported}, which is not an ancestor of ${expected} (a failed deploy, or an unknown commit)`,
    };
  }

  const changed = git.changedPaths(reported, expected);
  if (changed === null) {
    return { ok: false, reason: `reports ${reported}, and git could not say what changed since` };
  }

  const touched = changed.filter((file) => paths.some((prefix) => file.startsWith(prefix)));
  if (touched.length > 0) {
    return {
      ok: false,
      reason: `reports ${reported}, and ${touched.length} file(s) under ${paths.join(", ")} have changed since — a rebuild is owed`,
    };
  }

  return {
    ok: true,
    excused: true,
    reason: `serving ${reported}: nothing under ${paths.join(", ")} has changed since, so Render had no reason to rebuild`,
  };
}

export function commitMatches(reported, expected) {
  if (!reported) return false;
  const [longer, shorter] =
    reported.length >= expected.length ? [reported, expected] : [expected, reported];
  return longer.startsWith(shorter);
}

// Read from the blueprint rather than restated here, so that changing where
// the API builds from changes what this gate believes in the same commit.
// A blueprint this cannot read yields null, and null grants no exemption.
export function apiBuildPaths() {
  let blueprint;
  try {
    blueprint = readFileSync(path.join(repoRoot(), "render.yaml"), "utf8");
  } catch {
    return null;
  }

  const roots = [...blueprint.matchAll(/^\s*rootDir:\s*(\S+)\s*$/gm)].map(([, dir]) =>
    dir.replace(/^["']|["']$/g, "").replace(/^\.?\//, "").replace(/\/*$/, "/"),
  );

  // One service, one rootDir. Anything else means the blueprint has grown a
  // shape this was not written for, and guessing is not worth the downside.
  return roots.length === 1 ? roots : null;
}

function gitIn(cwd) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  };

  return {
    // git exits 0 for yes, 1 for no, and something else for "no such commit".
    // All three arrive here as the same answer, and that is correct: a commit
    // this checkout has never heard of is not one to excuse.
    isAncestor: (a, b) => run(["merge-base", "--is-ancestor", a, b]) !== null,
    changedPaths: (a, b) => {
      const out = run(["diff", "--name-only", a, b]);
      return out === null ? null : out.split("\n").filter(Boolean);
    },
  };
}
