// Applies src/db/auth-schema.sql, then creates or updates one account.
//
//   npm run auth:init                                  apply the schema only
//   npm run auth:user -- --email a@b.c --role admin     create or update an account
//
// Options for auth:user:
//   --email     required
//   --name      display name (defaults to the part before the @)
//   --role      admin | manager | assessor | viewer (default viewer)
//   --password  the password; if omitted a strong one is generated and printed
//   --premises  comma-separated premises ids to grant, or "all"
//   --reset     update the password of an existing account
//
// The generated password is printed once and never stored in plaintext. It is
// printed to stdout, so redirect it somewhere safe rather than leaving it in a
// shell scrollback that others can read.

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const { pool } = await import("../src/db/pool.js");
const { hashPassword, assertPasswordAcceptable } = await import("../src/auth/passwords.js");

const args = parseArgs(process.argv.slice(2));
const schemaOnly = !args.email;

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const sql = await readFile(path.join(backendRoot, "src", "db", "auth-schema.sql"), "utf8");
  await client.query(sql);
  console.log("Applied auth-schema.sql (users, user_premises, refresh_tokens, audit_log).");

  if (!schemaOnly) {
    await upsertUser(client, args);
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("\nFailed:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

if (schemaOnly && process.exitCode !== 1) {
  console.log(
    '\nNo account created. Run: npm run auth:user -- --email you@example.com --role admin --premises all',
  );
}

async function upsertUser(client, options) {
  const email = options.email.trim().toLowerCase();
  const role = options.role ?? "viewer";
  if (!["admin", "manager", "assessor", "viewer"].includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const fullName = options.name ?? email.split("@")[0];

  const { rows: existing } = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email],
  );

  let password = options.password ?? null;
  const needsPassword = existing.length === 0 || options.reset;
  if (needsPassword && !password) {
    // 32 bytes of randomness rendered base64url: long, unguessable, and
    // typeable enough to paste once.
    password = crypto.randomBytes(24).toString("base64url");
  }
  if (password) assertPasswordAcceptable(password, { email, fullName });

  let userId;
  if (existing.length === 0) {
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, fullName, await hashPassword(password), role],
    );
    userId = rows[0].id;
    console.log(`Created ${role} account ${email} (id ${userId}).`);
  } else {
    userId = existing[0].id;
    const assignments = ["role = $2", "full_name = $3", "is_active = TRUE", "updated_at = now()"];
    const params = [userId, role, fullName];
    if (password) {
      assignments.push(
        `password_hash = $${params.push(await hashPassword(password))}`,
        "password_changed_at = now()",
        "failed_login_attempts = 0",
        "locked_until = NULL",
      );
    }
    await client.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $1`, params);
    console.log(`Updated ${email} (id ${userId}) to role ${role}.`);
  }

  if (options.premises) {
    const ids =
      options.premises === "all"
        ? (await client.query("SELECT id FROM premises ORDER BY id")).rows.map((row) => row.id)
        : options.premises
            .split(",")
            .map((value) => Number(value.trim()))
            .filter(Number.isInteger);

    await client.query("DELETE FROM user_premises WHERE user_id = $1", [userId]);
    if (ids.length > 0) {
      await client.query(
        `INSERT INTO user_premises (user_id, premises_id)
         SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
        [userId, ids],
      );
    }
    console.log(
      role === "admin"
        ? `Granted ${ids.length} premises (an admin reaches every premises regardless).`
        : `Granted access to ${ids.length} premises.`,
    );
  }

  if (password && !options.password) {
    console.log(`\n  Password: ${password}`);
    console.log("  Shown once. Store it in a password manager now.\n");
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "reset") {
      result.reset = true;
      continue;
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}
