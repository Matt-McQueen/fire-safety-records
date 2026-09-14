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
//   npm run migrate:down      step the most recent one back, using its
//                             .down.sql
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
import { findDestructiveStatements, hasDestructiveApproval } from "./lib/destructive-sql.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "src", "db", "migrations");

const statusOnly = process.argv.includes("--status");
const dryRun = process.argv.includes("--dry-run");
const stepDown = process.argv.includes("--down");

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

  if (stepDown) {
    await reverseLastMigration(applied);
    process.exit(0);
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

  await refuseUnapprovedDestruction(pending);

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

// Refuses a migration that can destroy data or break the release currently
// running, unless the file says it meant to and there is a backup to fall back
// on. Both conditions, not either: an approval line without a backup is just a
// note saying the damage was intended.
//
// See lib/destructive-sql.mjs for what counts, and why the definition is wider
// than "deletes rows".
async function refuseUnapprovedDestruction(pending) {
  const flagged = [];

  for (const filename of pending) {
    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    const findings = findDestructiveStatements(sql);
    if (findings.length === 0) continue;
    flagged.push({ filename, findings, approved: hasDestructiveApproval(sql) });
  }

  if (flagged.length === 0) return;

  console.log("");
  for (const { filename, findings, approved } of flagged) {
    console.log(`${filename} ${approved ? "(destructive, approved)" : "is destructive:"}`);
    for (const finding of findings) console.log(`    ${finding.kind}: ${finding.why}`);
  }

  const unapproved = flagged.filter((entry) => !entry.approved);
  if (unapproved.length > 0) {
    console.error(
      [
        "",
        "Refusing to apply a destructive migration that has not said so.",
        "",
        "  Most of these have an additive form that breaks nothing: add the new",
        "  column now and drop the old one a release later, once nothing reads",
        "  it. The API and the frontend deploy separately, so the previous",
        "  release runs against the new schema for a few minutes either way —",
        "  see src/db/migrations/README.md.",
        "",
        "  If it genuinely has to happen, say so in the file, and why:",
        "",
        "    -- destructive: approved by <name> on <date> — <why not expand/contract>",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  await requireRecentBackup("a destructive migration");
}

// A backup taken before the change and recent enough to still describe the
// database this is about to alter.
//
// Local databases are exempt: they are disposable by construction, and
// demanding a backup of one would only teach everybody to route around this.
async function requireRecentBackup(what) {
  const url = new URL(process.env.DATABASE_URL);
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(url.hostname)) return;

  const maxAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 24);
  const backupDir = process.env.BACKUP_DIR;

  const refuse = (reason) => {
    console.error(
      [
        "",
        `Refusing to run ${what} against ${describeTarget(process.env.DATABASE_URL)}: ${reason}.`,
        "",
        "  Reverting the deploy reverts the code. It does not reverse this.",
        "",
        "    npm run backup          take one",
        "    npm run restore:check   prove it restores",
        "",
      ].join("\n"),
    );
    process.exit(1);
  };

  if (!backupDir) refuse("BACKUP_DIR is not set, so there is nothing to check");

  let manifests;
  try {
    manifests = (await readdir(backupDir)).filter((name) => name.endsWith(".manifest.json"));
  } catch {
    return refuse(`${backupDir} cannot be read`);
  }

  const database = url.pathname.replace(/^\//, "") || "postgres";
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let newest = null;

  for (const name of manifests) {
    const manifest = JSON.parse(await readFile(path.join(backupDir, name), "utf8"));
    if (manifest.host !== url.hostname || manifest.database !== database) continue;
    const takenAt = Date.parse(manifest.createdAt);
    if (!newest || takenAt > newest.takenAt) newest = { manifest, takenAt };
  }

  if (!newest) refuse(`there is no backup of ${url.hostname}/${database} in ${backupDir}`);
  if (newest.takenAt < cutoff) {
    const hours = ((Date.now() - newest.takenAt) / 3600000).toFixed(1);
    refuse(`the newest backup of this database is ${hours} hours old (limit ${maxAgeHours})`);
  }

  console.log(`\n  backup: ${newest.manifest.file} (${newest.manifest.objectCount} objects)`);
}

// Steps the most recently applied migration back, using the .down.sql written
// alongside it.
//
// Forward-only is still the rule for anything that has settled; this is for the
// promotion that has just gone wrong, where the code has been reverted and the
// schema has to follow it back. Reversing an additive migration loses nothing
// that existed before it — which is the whole reason migrations are supposed to
// be additive.
async function reverseLastMigration(applied) {
  if (applied.length === 0) {
    console.log("Nothing to reverse: no migrations have been applied.");
    return;
  }

  const last = applied[applied.length - 1].filename;
  const downName = last.replace(/\.sql$/, ".down.sql");
  const downPath = path.join(migrationsDir, downName);

  let sql;
  try {
    sql = await readFile(downPath, "utf8");
  } catch {
    console.error(
      [
        "",
        `${last} has no ${downName}, so it cannot be stepped back.`,
        "",
        "  Every migration is meant to ship with one. Where reversing is",
        "  genuinely impossible the file is supposed to say so rather than be",
        "  absent, so that this moment is not when anyone finds out.",
        "",
        "  What is left is restoring the backup taken before it was applied,",
        "  which loses everything written since — see README.md.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`Database: ${describeTarget(process.env.DATABASE_URL)}`);
  console.log(`Reversing ${last} with ${downName}`);
  await requireRecentBackup(`a down migration (${downName})`);

  if (dryRun) {
    console.log("\n--dry-run: nothing was reversed.");
    return;
  }

  await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE filename = $1", [last]);
    await client.query("COMMIT");
    console.log(`\nReversed ${last}. The schema is where it was before it was applied.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`\n${downName} was rolled back: ${error.message}`);
    process.exit(1);
  }
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
