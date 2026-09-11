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
