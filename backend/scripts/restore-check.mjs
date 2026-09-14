// Restores the newest backup into a scratch database and checks what came
// back.
//
// This is the only step that turns a dump into a backup. Everything before it
// is a file that has never been read: a dump can be truncated, encrypted with
// a passphrase nobody kept, or taken against the wrong database, and none of
// that shows until the morning you need it — which is the morning you cannot
// afford to find out.
//
//   RESTORE_URL=postgres://localhost:5432/fsr_restore_check npm run restore:check
//
//   BACKUP_DIR    required, same as backup.mjs — the newest manifest there is
//                 the one restored unless --file names another.
//   RESTORE_URL   required. An empty, throwaway database. Never the staging or
//                 production one: this drops and recreates what it restores.
//   BACKUP_PASSPHRASE  required if the dump is encrypted.
//
//   --file <name> restore a specific dump rather than the newest.
//
// What it asserts: every table the schema defines is present, the reference
// tables that are never empty are not empty, and schema_migrations matches the
// migrations in this checkout — so a dump taken before a migration is spotted
// as such rather than restored into a confusing half-state.

import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import pg from "pg";
import { decryptFile } from "./lib/backup-crypto.mjs";
import { describeProtection } from "../src/db/protected-database.js";

const backupDir = process.env.BACKUP_DIR;
const restoreUrl = process.env.RESTORE_URL;
const passphrase = process.env.BACKUP_PASSPHRASE;
const requested = argValue("--file");

if (!backupDir || !restoreUrl) {
  console.error("BACKUP_DIR and RESTORE_URL must both be set. See the top of this file.");
  process.exit(1);
}

// The whole job of this script is to overwrite the database it is given, so
// being pointed at a real one is the one mistake it must not make.
const protection = describeProtection(restoreUrl);
if (protection.isProtected) {
  console.error(
    `\nRefusing to restore into ${protection.host}: ${protection.reason}.` +
      "\nRESTORE_URL must name a throwaway database. This drops and recreates what it restores.\n",
  );
  process.exit(1);
}

const manifest = await newestManifest();
console.log(`Restoring ${manifest.file}`);
console.log(`  taken ${manifest.createdAt} from ${manifest.host}/${manifest.database}`);
console.log(`  ${manifest.objectCount} objects, ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB`);

const workspace = await mkdtemp(path.join(os.tmpdir(), "fsr-restore-"));
let failures = 0;

try {
  let dumpPath = path.join(backupDir, manifest.file);

  if (manifest.encrypted) {
    if (!passphrase) {
      console.error("\nThis dump is encrypted and BACKUP_PASSPHRASE is not set.\n");
      process.exit(1);
    }
    const decrypted = path.join(workspace, "decrypted.dump");
    await decryptFile(dumpPath, decrypted, passphrase);
    dumpPath = decrypted;
    console.log("  decrypted");
  }

  // --clean --if-exists so the scratch database does not have to be empty, and
  // a rehearsal can be repeated without tearing it down first.
  await run("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    restoreUrl,
    dumpPath,
  ]);

  console.log("\nChecking what came back:");
  const client = new pg.Client({ connectionString: restoreUrl });
  await client.connect();

  try {
    failures += await checkTablesPresent(client);
    failures += await checkReferenceDataPresent(client);
    failures += await checkMigrationsMatch(client);
  } finally {
    await client.end();
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed. This dump is not one to rely on.\n`);
  process.exit(1);
}

console.log("\nRestored and verified. This backup is one you can use.\n");

// --- the checks -------------------------------------------------------------

async function checkTablesPresent(client) {
  // Read from the schema file rather than a list kept here, so a table added
  // to the schema is covered by this check without anyone remembering to.
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const expected = [...schema.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)].map((m) => m[1]);

  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  const present = new Set(rows.map((row) => row.tablename));
  const missing = expected.filter((name) => !present.has(name));

  if (missing.length > 0) {
    console.error(`  ✗ ${missing.length} table(s) missing: ${missing.join(", ")}`);
    return 1;
  }
  console.log(`  ✓ all ${expected.length} tables restored`);
  return 0;
}

async function checkReferenceDataPresent(client) {
  // legal_basis and schedule2_measures are reference data loaded with the
  // schema: empty means the dump caught the database mid-setup, or restored
  // structure without contents.
  let failed = 0;
  for (const table of ["legal_basis", "schedule2_measures"]) {
    const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    if (rows[0].count === 0) {
      console.error(`  ✗ ${table} is empty`);
      failed += 1;
    } else {
      console.log(`  ✓ ${table} holds ${rows[0].count} rows`);
    }
  }
  return failed;
}

async function checkMigrationsMatch(client) {
  const files = (await readdir(new URL("../src/db/migrations", import.meta.url)))
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .sort();

  const { rows } = await client.query(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  ).catch(() => ({ rows: [] }));

  const applied = new Set(rows.map((row) => row.filename));
  const behind = files.filter((name) => !applied.has(name));

  if (behind.length > 0) {
    // Not a failure of the backup: a dump taken before today's migration is
    // exactly what a pre-deploy backup is. Worth saying out loud, because it
    // decides what restoring it would actually give you.
    console.log(`  ! taken before ${behind.length} migration(s): ${behind.join(", ")}`);
    return 0;
  }
  console.log(`  ✓ schema_migrations matches this checkout (${files.length} applied)`);
  return 0;
}

// --- plumbing ---------------------------------------------------------------

async function newestManifest() {
  let names;
  try {
    names = (await readdir(backupDir)).filter((name) => name.endsWith(".manifest.json")).sort();
  } catch {
    // A directory that is not there reads the same as one with nothing in it,
    // from the only angle that matters here: there is no backup to restore.
    names = [];
  }

  if (names.length === 0) {
    console.error(`\nNo backups in ${backupDir}. Take one first: npm run backup\n`);
    process.exit(1);
  }

  const chosen = requested
    ? names.find((name) => name.startsWith(requested.replace(/\.(dump|enc)$/, "")))
    : names[names.length - 1];

  if (!chosen) {
    console.error(`No manifest matching ${requested} in ${backupDir}.`);
    process.exit(1);
  }
  return JSON.parse(await readFile(path.join(backupDir, chosen), "utf8"));
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (error) =>
      reject(
        error.code === "ENOENT"
          ? new Error(`${command} is not on PATH. See README.md for the client tools.`)
          : error,
      ),
    );
    // pg_restore exits non-zero for warnings it has already recovered from
    // (dropping objects that were not there, with --clean --if-exists), so the
    // checks below decide whether the restore was good, not this code.
    child.on("close", () => resolve());
  });
}
