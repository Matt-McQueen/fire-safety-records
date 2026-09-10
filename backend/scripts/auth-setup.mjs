// Applies src/db/auth-schema.sql, then creates or updates one account.
//
//   npm run auth:init                                  apply the schema only
//   npm run auth:user -- --email a@b.c --role admin     create or update an account
//
// Options for auth:user:
//   --email     required
//   --name      display name (defaults to the part before the @)
//   --role      admin | manager | assessor | viewer (viewer for a new account;
//               an existing account keeps the role it has unless this is given)
//   --password  the password; if omitted a strong one is generated and printed
//   --premises  comma-separated premises ids to grant, or "all" (replaces the
//               existing grants; omit to leave them alone)
//   --reset     issue a new password for an existing account, keeping its role,
//               name and premises, and signing its existing sessions out
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

const ROLES = ["admin", "manager", "assessor", "viewer"];

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
  if (options.role && !ROLES.includes(options.role)) {
    throw new Error(`Unknown role: ${options.role}. One of: ${ROLES.join(", ")}`);
  }

  const { rows: existing } = await client.query(
    "SELECT id, role, full_name FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  const account = existing[0] ?? null;

  // On an existing account, only what was actually asked for changes. Defaulting
  // the role here would mean that resetting a password silently demoted the
  // account to viewer — and the account most likely to need a reset is the admin.
  const role = options.role ?? account?.role ?? "viewer";
  const fullName = options.name ?? account?.full_name ?? email.split("@")[0];

  let password = options.password ?? null;
  const needsPassword = !account || options.reset;
  if (needsPassword && !password) {
    // 24 bytes rendered base64url: long, unguessable, and short enough to paste
    // into a password manager once.
    password = crypto.randomBytes(24).toString("base64url");
  }
  if (password) assertPasswordAcceptable(password, { email, fullName });

  let userId;
  if (!account) {
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, fullName, await hashPassword(password), role],
    );
    userId = rows[0].id;
    console.log(`Created ${role} account ${email} (id ${userId}).`);
  } else {
    userId = account.id;
    const assignments = ["role = $2", "full_name = $3", "is_active = TRUE", "updated_at = now()"];
    const params = [userId, role, fullName];
    if (password) {
      assignments.push(
        `password_hash = $${params.push(await hashPassword(password))}`,
        "password_changed_at = now()",
        "failed_login_attempts = 0",
        "locked_until = NULL",
      );
      // Changing the password here does what changing it through the API does:
      // closes every session, so a compromised one cannot outlive the reset.
      await client.query(
        `UPDATE refresh_tokens
            SET revoked_at = now(), revoked_reason = 'password_reset'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    }
    await client.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $1`, params);
    console.log(
      password
        ? `Reset the password for ${email} (id ${userId}, role ${role}). Existing sessions are signed out.`
        : `Updated ${email} (id ${userId}) to role ${role}.`,
    );
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
