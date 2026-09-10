// Test harness.
//
// The tests run against the real database, because what they are checking —
// premises scoping, transactional rules, generated columns, foreign keys — is
// not something a stubbed pool would exercise. Everything they create is
// namespaced with a per-run marker and removed afterwards, so a run leaves the
// database as it found it and two runs cannot collide.

// Set before anything reads the configuration: `test` disables the blanket
// rate limit, and a low scrypt cost keeps a suite that creates a dozen accounts
// from spending most of its time hashing.
process.env.NODE_ENV = "test";
process.env.SCRYPT_COST = process.env.SCRYPT_COST ?? "1024";
// The sign-in limiter is keyed by address, and every test signs in from the
// same one. Raised here so it does not throttle the suite; the limiter itself
// is exercised by lowering `config` at the end of tests/auth.test.mjs.
process.env.RATE_LIMIT_LOGIN = process.env.RATE_LIMIT_LOGIN ?? "10000";
// Supabase's pooler caps the clients a project may hold open, so the suite
// keeps a small pool. The npm script also runs the files one at a time.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "5";

import crypto from "node:crypto";
import { after } from "node:test";

const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db/db.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { config } = await import("../src/config/env.js");

export { config };

export { pool };

// Long enough to satisfy the password policy, and constant so the tests are
// readable. Never used outside the test database.
export const TEST_PASSWORD = "correct-horse-battery-staple-42";

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://localhost:${server.address().port}`;

// Everything a run creates carries this, so cleanup can find it and concurrent
// runs cannot delete each other's rows.
export const marker = `apitest-${crypto.randomUUID().slice(0, 8)}`;

export function tag(name) {
  return `[${marker}] ${name}`;
}

// --- requests --------------------------------------------------------------

export function client(accessToken) {
  const request = async (method, path, body, options = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(options.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      status: response.status,
      body: parsed,
      headers: response.headers,
      // The value of a Set-Cookie, so the refresh flow can be driven.
      cookies: response.headers.getSetCookie?.() ?? [],
    };
  };

  return {
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body ?? {}, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    delete: (path, options) => request("DELETE", path, undefined, options),
    raw: request,
  };
}

export const anonymous = client();

// --- fixtures --------------------------------------------------------------

const createdUserIds = [];
const createdPremisesIds = [];

// Accounts are inserted directly rather than through the API: the API needs an
// admin to create the first one, which is the thing being set up.
export async function makeUser(role, { premisesIds = [], email } = {}) {
  const address = email ?? `${marker}-${role}-${createdUserIds.length}@example.test`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id, email, role`,
    [address, `${marker} ${role}`, await hashPassword(TEST_PASSWORD), role],
  );
  const user = rows[0];
  createdUserIds.push(user.id);

  if (premisesIds.length > 0) {
    await pool.query(
      `INSERT INTO user_premises (user_id, premises_id)
       SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
      [user.id, premisesIds],
    );
  }
  return user;
}

export async function signIn(user, password = TEST_PASSWORD) {
  const response = await anonymous.post("/api/auth/login", { email: user.email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in failed for ${user.email}: ${JSON.stringify(response.body)}`);
  }
  return {
    ...client(response.body.data.accessToken),
    accessToken: response.body.data.accessToken,
    refreshCookie: refreshCookieFrom(response),
    user: response.body.data.user,
  };
}

// A signed-in client for each role, all scoped to the same premises.
export async function makeRoles(premisesId) {
  const premisesIds = premisesId ? [premisesId] : [];
  const [admin, manager, assessor, viewer] = await Promise.all([
    makeUser("admin"),
    makeUser("manager", { premisesIds }),
    makeUser("assessor", { premisesIds }),
    makeUser("viewer", { premisesIds }),
  ]);
  return {
    admin: await signIn(admin),
    manager: await signIn(manager),
    assessor: await signIn(assessor),
    viewer: await signIn(viewer),
    accounts: { admin, manager, assessor, viewer },
  };
}

export function refreshCookieFrom(response) {
  const cookie = response.cookies.find((value) => value.startsWith("fsr_refresh="));
  return cookie ? cookie.split(";")[0] : null;
}

// Inserted directly for the same reason as the users: several tests need a
// premises to exist before any API call is made.
export async function makePremises(overrides = {}) {
  const { rows } = await pool.query(
    `INSERT INTO premises (name, town, employee_count, requires_licence, licence_details)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      overrides.name ?? tag("Premises"),
      overrides.town ?? "Glasgow",
      overrides.employee_count ?? 12,
      overrides.requires_licence ?? false,
      overrides.licence_details ?? null,
    ],
  );
  createdPremisesIds.push(rows[0].id);
  return rows[0];
}

export async function makePerson(overrides = {}) {
  const { rows } = await pool.query(
    `INSERT INTO people (full_name, job_title, is_employee)
     VALUES ($1, $2, $3) RETURNING *`,
    [overrides.full_name ?? tag("Person"), overrides.job_title ?? "Officer", overrides.is_employee ?? true],
  );
  return rows[0];
}

// --- cleanup ---------------------------------------------------------------

// Deleting the premises cascades through every record held against it, and the
// people and users are matched by the run's marker. Done in SQL, not through
// the API, because several of the API's own rules exist to stop exactly this.
export async function cleanup() {
  await pool.query("DELETE FROM audit_log WHERE user_id = ANY($1)", [createdUserIds]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`${marker}-%`]);
  await pool.query("DELETE FROM premises WHERE name LIKE $1", [`[${marker}]%`]);
  await pool.query("DELETE FROM people WHERE full_name LIKE $1", [`[${marker}]%`]);
  await pool.query("DELETE FROM check_schedules WHERE notes LIKE $1", [`[${marker}]%`]);
}

// Registered once per test file, so a file that throws still tidies up.
after(async () => {
  await cleanup();
  server.close();
  await pool.end();
});
