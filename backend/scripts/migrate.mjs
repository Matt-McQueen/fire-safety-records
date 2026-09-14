// Applies pending schema migrations, in order, once each.
//
// Why this exists: staging and production are two different databases on two
// different providers (Neon and Supabase). Promoting a branch moves the code
// and nothing else, so a change that needs a new column works on staging —
// where the SQL was run by hand while developing it — and takes production
// down the moment the same code deploys there. Nothing in a branch merge can
// notice that. A migration that is a committed file, applied by a step of the
// promotion, is what makes the schema travel with the code that needs it.
//
//   npm run migrate           apply everything pending
//   npm run migrate:status    list applied and pending, change nothing
//   npm run migrate -- --dry-run   print what would run
//
// Each file runs inside its own transaction along with the row recording it,
// so a failure leaves the database on the last migration that fully succeeded
// rather than halfway through this one. Postgres has transactional DDL, which
// is what makes that possible.
//
// See src/db/migrations/README.md for how to write one.

import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "src", "db", "migrations");

const statusOnly = process.argv.includes("--status");
const dryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

// Deliberately not src/db/pool.js: that pool is sized and tuned for serving
// requests, and a migration is a single short-lived connection.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// An arbitrary constant, the same in every process that runs this. Two deploys
// landing at once would otherwise both see the same migration as pending and
// both try to apply it; the loser fails on a duplicate object rather than
// waiting its turn.
const LOCK_ID = 4_812_337;

try {
  await client.connect();
} catch (error) {
  console.error(`Could not connect to ${describeTarget(process.env.DATABASE_URL)}: ${error.message}`);
  process.exit(1);
}

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const { rows: applied } = await client.query(
    "SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename",
  );
  const appliedByName = new Map(applied.map((row) => [row.filename, row]));

  // A migration that changed after it was applied is a real problem, not a
  // formality: the database no longer matches the file, and every environment
  // that applies it later gets something different from the one that ran it
  // first. Checked before anything else, because it invalidates the rest.
  const altered = [];
  for (const [filename, row] of appliedByName) {
    if (!files.includes(filename)) {
      altered.push(`${filename} was applied but is no longer in the repository`);
      continue;
    }
    const checksum = await checksumOf(filename);
    if (checksum !== row.checksum) {
      altered.push(`${filename} has changed since it was applied`);
    }
  }
  if (altered.length > 0) {
    console.error("Applied migrations have been edited:\n");
    for (const problem of altered) console.error(`  - ${problem}`);
    console.error(
      "\nMigrations are forward-only. Restore the file as it was applied and write" +
        "\na new migration for the change instead.",
    );
    process.exit(1);
  }

  const pending = files.filter((name) => !appliedByName.has(name));

  if (statusOnly) {
    console.log(`Database: ${describeTarget(process.env.DATABASE_URL)}\n`);
    if (applied.length === 0) console.log("Applied: none");
    for (const row of applied) {
      console.log(`  applied  ${row.filename}  ${row.applied_at.toISOString()}`);
    }
    if (pending.length === 0) console.log("\nPending: none — the database is up to date.");
    for (const name of pending) console.log(`  pending  ${name}`);
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log("Nothing to apply; the database is up to date.");
    process.exit(0);
  }

  console.log(`Database: ${describeTarget(process.env.DATABASE_URL)}`);
  console.log(`${pending.length} migration(s) to apply:\n`);
  for (const name of pending) console.log(`  ${name}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing was applied.");
    process.exit(0);
  }

  await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);

  for (const filename of pending) {
    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    const checksum = await checksumOf(filename);
    process.stdout.write(`\napplying ${filename} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
        filename,
        checksum,
      ]);
      await client.query("COMMIT");
      console.log("done");
    } catch (error) {
      await client.query("ROLLBACK");
      console.log("failed");
      console.error(`\n${filename} was rolled back: ${error.message}`);
      console.error(
        "Nothing after it has been applied. The database is on the last migration" +
          "\nthat fully succeeded, which is a state the previous deploy ran against.",
      );
      process.exit(1);
    }
  }

  console.log("\nAll migrations applied.");
} finally {
  await client.end();
}

async function checksumOf(filename) {
  const contents = await readFile(path.join(migrationsDir, filename), "utf8");
  // Newlines normalised so a checkout on Windows does not read as a different
  // migration from the one applied from a checkout on Linux.
  return crypto.createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

// Host and database only. The connection string carries a password, and this
// output goes into CI logs.
function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
