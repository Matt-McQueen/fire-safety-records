// A throwaway git repository, shaped like this one.
//
// Both the judgement in deploy-scope.mjs and the gate that consults it decide
// what to do by asking git about real history, so the honest way to test
// either is to give it some. Building it here rather than stubbing git keeps
// the interesting failures reachable: an unknown commit, a commit on a line
// that was never merged, a blueprint that has changed shape.
//
//   first ── backendChange ── rootOnlyChange        (the line being promoted)
//        └── sideways                               (never merged)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function buildRepo(t, { rootDir = "backend" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-scope-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file, body) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  };
  const commit = (message) => {
    git("add", "-A");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-m", message);
    return git("rev-parse", "HEAD");
  };

  git("init", "-b", "main");
  // Otherwise every `git add` on Windows warns about line endings, and the
  // warnings bury the test output they are printed among.
  git("config", "core.autocrlf", "false");
  write("render.yaml", `services:\n  - type: web\n    rootDir: ${rootDir}\n    plan: free\n`);
  write("backend/src/index.js", "// one\n");
  write("README.md", "# one\n");
  const first = commit("first");

  write("backend/src/index.js", "// two\n");
  const backendChange = commit("a change the API is built from");

  write("README.md", "# two\n");
  write("CLAUDE.md", "rules\n");
  const rootOnlyChange = commit("a change at the repository root only");

  git("checkout", "--quiet", "-b", "sideways", first);
  write("README.md", "# elsewhere\n");
  const sideways = commit("a commit on a line that was never promoted");
  git("checkout", "--quiet", "main");

  // Every judgement in this file is made against this repository.
  const previous = process.env.SMOKE_REPO_ROOT;
  process.env.SMOKE_REPO_ROOT = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.SMOKE_REPO_ROOT;
    else process.env.SMOKE_REPO_ROOT = previous;
  });

  return { dir, git, first, backendChange, rootOnlyChange, sideways };
}
