// Reads what tests/global.setup.js wrote. A plain module (no "test"/"spec" in
// the filename), so Playwright's test discovery does not pick it up as a
// suite of its own.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const authDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.auth");

let cached;

// Deliberately not read at module load: every spec file is imported up front
// to build the run's test list, before the "setup" project (which writes
// this file) has actually run. Call this from a beforeAll instead.
export async function loadFixtures() {
  if (!cached) cached = JSON.parse(await readFile(path.join(authDir, "fixtures.json"), "utf8"));
  return cached;
}

export function authStatePath(role) {
  return path.join(authDir, `${role}.json`);
}

// Signs in through the real login form on the given page. Prefer this over
// authStatePath for any role more than one test file needs: a saved session's
// refresh cookie is single-use (see tests/global.setup.js), so two files
// restoring the same one into two contexts race to consume it and the loser's
// session gets revoked. A fresh login has no such limit.
export async function signIn(page, { email, password }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}
