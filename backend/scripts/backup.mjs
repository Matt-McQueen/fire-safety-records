// Takes a verified, optionally encrypted dump of the database DATABASE_URL
// names, and writes a manifest beside it.
//
// Why this is a script and not a line in the README: Supabase's Free plan
// takes no backups at all — not daily, not point in time — so for the
// production database this is the only copy that will ever exist. A sentence
// telling someone to "snapshot the database first" is not a backup; a command
// that runs, checks its own output and records what it did, is.
//
//   npm run backup
//
// Configuration:
//
//   BACKUP_DIR          required. Where dumps go. Deliberately has no default:
//                       a default would eventually be inside the repository,
//                       and this repository is public. Put it somewhere you
//                       control, on a disk you back up, outside the checkout.
//   BACKUP_PASSPHRASE   optional but strongly advised. Encrypts the dump
//                       (AES-256-GCM). A dump of this database is the same
//                       personal data the API protects — including special
//                       category data under UK GDPR Art.9 in
//                       fra_persons_at_risk — with none of the access control.
//                       Lose the passphrase and you lose the backup: store it
//                       in your password manager before you use it.
//   BACKUP_KEEP         how many dumps to keep per database (default 10).
//   BACKUP_DATABASE_URL which database to back up. Prefer this over letting it
//                       fall through to DATABASE_URL, which is whatever this
//                       checkout happens to point at — for a developer, their
//                       own database. A local target is refused outright unless
//                       --allow-local says it was meant.
//
// Needs the PostgreSQL client tools (pg_dump, pg_restore) on PATH, at a major
// version at or above the server's — they do not ship with Node. Install the
// local server with them: restore-check.mjs has to put the dump somewhere, and
// a backup nobody has restored is a guess. See README.md.

import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import pg from "pg";
import { encryptFile } from "./lib/backup-crypto.mjs";

const backupDir = process.env.BACKUP_DIR;
const passphrase = process.env.BACKUP_PASSPHRASE;
const keep = Number(process.env.BACKUP_KEEP ?? 10);

// Which database this backs up, said out loud rather than inherited.
//
// DATABASE_URL is whatever the checkout is currently pointed at, and for a
// developer that is their own local database. `npm run backup` with no thought
// therefore produces a perfectly valid, perfectly useless backup of an empty
// dev database, reports success, and leaves someone believing production is
// covered. That is the worst shape a safety feature can take.
//
// So: BACKUP_DATABASE_URL wins if it is set, and a local target is refused
// unless --allow-local says it was meant. Backing up localhost is a reasonable
// thing to want occasionally; doing it by accident is not.
const explicitTarget = process.env.BACKUP_DATABASE_URL?.trim();
const databaseUrl = explicitTarget || process.env.DATABASE_URL;
const allowLocal = process.argv.includes("--allow-local");

if (!databaseUrl) {
  console.error(
    [
      "Nothing to back up: neither BACKUP_DATABASE_URL nor DATABASE_URL is set.",
      "",
      "  BACKUP_DATABASE_URL is the one to prefer — it names the database this",
      "  backup is for, rather than inheriting whatever the checkout happens to",
      "  be pointed at.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (isLocalHost(databaseUrl) && !allowLocal) {
  console.error(
    [
      "",
      `Refusing to back up ${describeTarget(databaseUrl).label}: it is a local database.`,
      "",
      explicitTarget
        ? "  BACKUP_DATABASE_URL names it, which is unusual but explicit."
        : "  This is DATABASE_URL — whatever this checkout is pointed at, which for",
      explicitTarget ? null : "  a developer is their own database rather than production.",
      "",
      "  A backup of a local database is a valid file and almost never the one",
      "  anyone wanted. If it is what you meant, say so:",
      "",
      "    npm run backup -- --allow-local",
      "",
      "  To back up production, name it:",
      "",
      "    $env:BACKUP_DATABASE_URL = '<the production connection string>'",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
  process.exit(1);
}

function isLocalHost(url) {
  try {
    return /^(localhost|127\.0\.0\.1|::1)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

if (!backupDir) {
  console.error(
    [
      "BACKUP_DIR is not set, and there is deliberately no default.",
      "",
      "  A dump of this database holds the personal data the API exists to",
      "  protect, so it must not land anywhere casual — and a default would",
      "  sooner or later be a directory inside this repository, which is public.",
      "",
      "  Set it to somewhere you control and back up, outside the checkout:",
      "",
      '    $env:BACKUP_DIR = "C:\\Backups\\fire-safety-records"',
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const target = describeTarget(databaseUrl);

if (!passphrase) {
  console.warn(
    [
      "",
      "  BACKUP_PASSPHRASE is not set, so this dump will be written in the clear.",
      "  It will contain every name, job title and recorded reason a person is at",
      "  risk — special category data under UK GDPR Art.9. Set a passphrase unless",
      "  the destination is itself encrypted and access controlled.",
      "",
    ].join("\n"),
  );
}

const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, "-");
const base = `${target.database}-${stamp}`;

await mkdir(backupDir, { recursive: true });

const plainPath = path.join(backupDir, `${base}.dump`);
const finalPath = passphrase ? `${plainPath}.enc` : plainPath;

console.log(`Backing up ${target.label}`);

const { serverVersion, migrations } = await readDatabaseFacts(databaseUrl);
await assertClientIsNewEnough(serverVersion);

// Custom format: compressed, and restorable table by table, which matters when
// the thing that went wrong only touched one of them.
await run("pg_dump", [
  "--format=custom",
  // Our schema, and only ours. A Supabase database also carries the platform's
  // own — auth, storage, realtime, vault — which between them were more than
  // half the tables in the first dump taken here. They are owned by roles that
  // exist nowhere else (supabase_auth_admin and friends), so a dump containing
  // them will not restore into an ordinary Postgres: the rehearsal fails, or
  // worse, half-succeeds. They are also not ours to restore. Everything this
  // application creates lives in public — no CREATE SCHEMA, no extensions —
  // and restore-check.mjs verifies every table in schema.sql came back, which
  // is what would notice if that ever stopped being true.
  "--schema=public",
  "--no-owner",
  "--no-privileges",
  "--file",
  plainPath,
  databaseUrl,
]);

// A dump that cannot be listed cannot be restored, and finding that out now is
// the entire difference between a backup and a file.
const objectCount = await countRestorableObjects(plainPath);
if (objectCount === 0) {
  console.error(`${plainPath} contains no restorable objects. Not treating this as a backup.`);
  await rm(plainPath, { force: true });
  process.exit(1);
}

if (passphrase) {
  await encryptFile(plainPath, finalPath, passphrase);
  await rm(plainPath, { force: true });
}

const { size } = await stat(finalPath);
const manifest = {
  createdAt: started.toISOString(),
  host: target.host,
  database: target.database,
  serverVersion,
  file: path.basename(finalPath),
  bytes: size,
  sha256: await sha256(finalPath),
  objectCount,
  // Recorded so a restore knows what it is getting, and so a later change of
  // scope is visible in the manifests rather than only in the code.
  schemas: ["public"],
  encrypted: Boolean(passphrase),
  // What schema is in this dump, and roughly what code it was taken alongside.
  migrations,
  commit: await checkoutCommit(),
};

const manifestPath = path.join(backupDir, `${base}.manifest.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`  ${manifest.file}  ${(size / 1024 / 1024).toFixed(1)} MB  ${objectCount} objects`);
console.log(`  ${path.basename(manifestPath)}`);
if (passphrase) console.log("  encrypted — without the passphrase this file is unrecoverable");

await prune();

console.log(
  "\nA backup nobody has restored is a guess. Rehearse it: npm run restore:check\n",
);

// --- the pieces -------------------------------------------------------------

// The server version, and the migrations this database has applied.
//
// The migration list is what a restore actually needs to know. "Taken on the
// 15th" says nothing about which schema the dump contains; "applied up to
// 0004" says exactly that, and restore-check.mjs compares it against the
// checkout so a dump taken before today's migration is spotted as such rather
// than restored into a confusing half-state.
async function readDatabaseFacts(url) {
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const version = await client.query("SHOW server_version");

    // Null rather than [] where the table does not exist: "no migrations have
    // been applied" and "this database predates the migration runner" are
    // different facts, and only one of them is reassuring.
    const applied = await client
      .query("SELECT filename FROM schema_migrations ORDER BY filename")
      .then((result) => result.rows.map((row) => row.filename))
      .catch(() => null);

    return { serverVersion: version.rows[0].server_version, migrations: applied };
  } catch (error) {
    console.error(`Could not reach ${target.label}: ${error.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

// The checkout this was taken from, which is a hint and not a promise: the
// machine running the backup is not necessarily on the same commit as the
// deployment whose database it is backing up. The migration list above is the
// authoritative answer to "what schema is in here".
async function checkoutCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return (await capture("git", ["rev-parse", "HEAD"])).trim() || null;
  } catch {
    return null;
  }
}

// pg_dump refuses a server newer than itself, and the error it gives says
// little about what to do. Checked up front so the advice can be specific.
async function assertClientIsNewEnough(server) {
  let clientVersion;
  try {
    clientVersion = await capture("pg_dump", ["--version"]);
  } catch {
    console.error(
      [
        "pg_dump is not on PATH.",
        "",
        "  The PostgreSQL client tools do not come with Node. On Windows:",
        "",
        "    winget install PostgreSQL.PostgreSQL.17 --interactive",
        "",
        "  Install the server alongside them rather than the tools on their own:",
        "  restore-check.mjs has to restore the dump into something, and without a",
        "  local server there is nowhere for a rehearsal to go.",
        "",
        `  Install a client at major version ${major(server)} or above, to match the server.`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (major(clientVersion) < major(server)) {
    console.error(
      `pg_dump is version ${major(clientVersion)} and ${target.host} runs ${major(server)}.` +
        "\npg_dump refuses a server newer than itself. Install a client at that major version or above.",
    );
    process.exit(1);
  }
}

async function countRestorableObjects(dumpPath) {
  const listing = await capture("pg_restore", ["--list", dumpPath]);
  return listing.split("\n").filter((line) => line.trim() && !line.startsWith(";")).length;
}

// Keeps the newest `keep` dumps for this database and removes the rest with
// their manifests. Other databases' dumps in the same directory are left alone.
async function prune() {
  const entries = (await readdir(backupDir))
    .filter((name) => name.startsWith(`${target.database}-`) && name.includes(".manifest.json"))
    .sort()
    .reverse();

  const stale = entries.slice(keep);
  for (const manifestName of stale) {
    const prefix = manifestName.replace(".manifest.json", "");
    for (const name of await readdir(backupDir)) {
      if (name.startsWith(prefix)) await rm(path.join(backupDir, name), { force: true });
    }
  }
  if (stale.length > 0) console.log(`  pruned ${stale.length} older backup(s), keeping ${keep}`);
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function major(version) {
  return Number(String(version).split(".")[0].replace(/\D/g, ""));
}

// Host and database only: the connection string carries a password and this
// output is meant to be pasted into a note about what was backed up.
function describeTarget(url) {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "") || "postgres";
  return { host: parsed.hostname, database, label: `${parsed.hostname}/${database}` };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `${command} exited with ${code}`)),
    );
  });
}
