// Integration tests for scripts/migrate.mjs, against a real database.
//
// The unit tests in tests/unit/destructiveSql.test.mjs cover what counts as
// destructive. These cover what the runner does about it, and the part that
// only a real database can show: that a migration applies inside a
// transaction, that it is recorded, and that its .down.sql puts the schema
// back where it was.
//
// Everything here writes to a temporary table and a temporary migration file,
// both named for this run and removed afterwards.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";

// Before anything connects. These tests apply migrations to whatever
// DATABASE_URL names, which is the one thing that must never be production.
const { assertDisposableDatabase } = await import("../src/db/protected-database.js");
assertDisposableDatabase("the migration tests");

const { pool } = await import("../src/db/pool.js");

// These tests apply real migrations to whatever DATABASE_URL names, and a
// migration is not a fixture: it alters the schema rather than adding rows that
// can be deleted again by marker. That is right against a database created for
// the run and wrong against anything else - pointed at deployed staging, this
// file added a column to the real premises table and then spent two and a half
// minutes failing to reverse it, because the runner refused a down migration
// without a recent backup. The runner was right. The test had no business being
// there.
//
// Local means disposable here, the same judgement scripts/migrate.mjs makes
// when deciding whether to insist on a backup.
const targetHost = new URL(process.env.DATABASE_URL).hostname;
const notLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(targetHost)
  ? false
  : `these apply migrations to the database itself, and ${targetHost} is not a local one`;

const backendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(backendRoot, "src", "db", "migrations");

// 9990 upwards, so a real migration added while these exist still sorts first
// and these are always the last to apply.
const marker = crypto.randomUUID().slice(0, 8).replace(/-/g, "");
const written = [];

async function writeMigration(name, sql) {
  const file = path.join(migrationsDir, name);
  await writeFile(file, sql);
  written.push(file);
  return name;
}

function migrate(args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join("scripts", "migrate.mjs"), ...args], {
      cwd: backendRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
}

async function columnExists(table, column) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

test("an additive migration applies, is recorded, and its down migration reverses it", { skip: notLocal }, async () => {
  const column = `test_${marker}_note`;
  const name = await writeMigration(
    `9990_add_${marker}.sql`,
    `-- Added by tests/migrations.test.mjs. Nullable, so the release already\n` +
      `-- running keeps working against it.\n` +
      `ALTER TABLE premises ADD COLUMN ${column} TEXT;\n`,
  );
  await writeMigration(
    `9990_add_${marker}.down.sql`,
    `ALTER TABLE premises DROP COLUMN IF EXISTS ${column};\n`,
  );

  const applied = await migrate();
  assert.equal(applied.code, 0, applied.output);
  assert.match(applied.output, new RegExp(`applying ${name}`));
  assert.equal(await columnExists("premises", column), true, "the column was not added");

  // The reversal must never be mistaken for a migration of its own. Applying
  // it forward would undo the change on the very next deploy — dropping the
  // column it exists to be able to put back — and CI caught exactly that.
  assert.ok(
    !applied.output.includes(".down.sql"),
    `a .down.sql was treated as a pending migration:\n${applied.output}`,
  );

  const { rows: recorded } = await pool.query(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    [name],
  );
  assert.equal(recorded.length, 1, "the migration was not recorded");
  assert.match(recorded[0].checksum, /^[0-9a-f]{64}$/);

  // Applying again is a no-op rather than an error, which is what makes it
  // safe to run as an unconditional step of a deploy.
  const again = await migrate();
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /up to date/);

  const reversed = await migrate(["--down"]);
  assert.equal(reversed.code, 0, reversed.output);
  assert.equal(await columnExists("premises", column), false, "the column was not dropped");

  const { rows: afterDown } = await pool.query(
    "SELECT 1 FROM schema_migrations WHERE filename = $1",
    [name],
  );
  assert.equal(afterDown.length, 0, "the migration is still recorded as applied");
});

test("a destructive migration is refused unless it says so", { skip: notLocal }, async () => {
  // Harmless if it ever did run: the table does not exist. Destructive by
  // shape, which is what the runner judges on.
  const name = await writeMigration(
    `9991_drop_${marker}.sql`,
    `DROP TABLE IF EXISTS a_table_that_never_existed_${marker};\n`,
  );

  const refused = await migrate();
  assert.equal(refused.code, 1, refused.output);
  assert.match(refused.output, /Refusing to apply a destructive migration/);
  assert.match(refused.output, /drop-table/);

  const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [name]);
  assert.equal(rows.length, 0, "a refused migration was recorded as applied");
});

test("the approval line is what unlocks it", { skip: notLocal }, async () => {
  const file = path.join(migrationsDir, `9991_drop_${marker}.sql`);
  const sql = await readFile(file, "utf8");
  await writeFile(
    file,
    `-- destructive: approved by the test suite on 2026-09-14 — the table is fictional\n${sql}`,
  );

  // The backup requirement does not apply to a local database (see
  // requireRecentBackup), so against CI's Postgres this now goes through.
  const applied = await migrate();
  assert.equal(applied.code, 0, applied.output);
  assert.match(applied.output, /destructive, approved/);
});

test("an applied migration cannot be edited afterwards", { skip: notLocal }, async () => {
  const file = path.join(migrationsDir, `9990_add_${marker}.sql`);
  // 9990 was reversed above, so re-apply it to have something recorded.
  await migrate();

  const original = await readFile(file, "utf8");
  await writeFile(file, `${original}-- edited after the fact\n`);

  const refused = await migrate();
  assert.equal(refused.code, 1, refused.output);
  assert.match(refused.output, /has changed since it was applied/);

  await writeFile(file, original);
});

test.after(async () => {
  for (const file of written) await rm(file, { force: true });

  // Skipped tests created nothing, so the cleanup has nothing to undo — and it
  // is itself a DELETE and an ALTER TABLE, which have no business running
  // against a database these tests declined to touch.
  if (!notLocal) {
    // Anything these tests recorded or added, removed - in the order that
    // leaves nothing behind even if a test failed partway.
    await pool.query("DELETE FROM schema_migrations WHERE filename LIKE $1", [`999%_${marker}%`]);
    await pool.query(`ALTER TABLE premises DROP COLUMN IF EXISTS test_${marker}_note`);
  }

  await pool.end();
});
