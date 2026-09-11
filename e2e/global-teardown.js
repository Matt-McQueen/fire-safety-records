// Removes everything tests/global.setup.js created, mirroring the cleanup in
// backend/tests/helpers.mjs: fixtures are namespaced with a per-run marker,
// so this can find and remove exactly what this run added and nothing else.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../backend");
const authDir = path.resolve(here, ".auth");

export default async function globalTeardown() {
  let fixtures;
  try {
    fixtures = JSON.parse(await readFile(path.join(authDir, "fixtures.json"), "utf8"));
  } catch {
    return; // Setup never got as far as writing it - nothing to clean up.
  }

  dotenv.config({ path: path.join(backendRoot, ".env") });
  const { pool } = await import(pathToFileURL(path.join(backendRoot, "src/db/pool.js")).href);

  const { marker } = fixtures;
  try {
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [
      `${marker}-%`,
    ]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${marker}-%`]);
    await pool.query(`DELETE FROM premises WHERE name LIKE $1`, [`[${marker}]%`]);
  } finally {
    await pool.end();
  }
}
