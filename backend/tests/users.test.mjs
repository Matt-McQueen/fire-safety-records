// /api/users — account administration. Creating, deactivating and
// searching accounts, and the two account-recovery levers (clearing a
// lockout, granting premises at creation time), none of which the other
// test files exercise: tests/authorisation.test.mjs covers who may reach
// this router and the premises-narrowing side effect of a PATCH, but never
// actually creates or removes an account.

import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymous,
  makePremises,
  makeRoles,
  marker,
  pool,
  signIn,
  tag,
  TEST_PASSWORD,
} from "./helpers.mjs";

test("an admin creates an account, which can sign in immediately with the given password", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const email = `${marker}-created@example.test`;

  const created = await admin.post("/api/users", {
    email,
    full_name: tag("New Assessor"),
    password: "correct-horse-battery-staple-7",
    role: "assessor",
  });

  assert.equal(created.status, 201);
  assert.ok(created.headers.get("location")?.endsWith(`/${created.body.data.id}`));
  assert.equal(created.body.data.email, email);
  assert.equal(created.body.data.role, "assessor");
  assert.deepEqual(created.body.data.premises_ids, []);
  assert.ok(!("password" in created.body.data) && !("password_hash" in created.body.data));

  const login = await anonymous.post("/api/auth/login", {
    email,
    password: "correct-horse-battery-staple-7",
  });
  assert.equal(login.status, 200);
});

test("creating an account grants the premises named, so the new account can read them straight away", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const email = `${marker}-granted@example.test`;

  const created = await admin.post("/api/users", {
    email,
    full_name: tag("Granted Viewer"),
    password: "correct-horse-battery-staple-7",
    role: "viewer",
    premises_ids: [premises.id],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.data.premises_ids, [premises.id]);

  const session = await signIn({ email }, "correct-horse-battery-staple-7");
  assert.equal((await session.get(`/api/premises/${premises.id}`)).status, 200);
});

test("creating an account against a premises that does not exist is refused, naming it", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);

  const response = await admin.post("/api/users", {
    email: `${marker}-orphan@example.test`,
    full_name: tag("Orphan"),
    password: "correct-horse-battery-staple-7",
    role: "viewer",
    premises_ids: [999_999_999],
  });
  assert.equal(response.status, 404);
  assert.match(response.body.error.message, /999999999/);
});

test("creating an account with an email already in use is refused as a conflict", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const email = `${marker}-dup@example.test`;

  const first = await admin.post("/api/users", {
    email,
    full_name: tag("First"),
    password: "correct-horse-battery-staple-7",
    role: "viewer",
  });
  assert.equal(first.status, 201);

  const second = await admin.post("/api/users", {
    email: email.toUpperCase(),
    full_name: tag("Second"),
    password: "correct-horse-battery-staple-7",
    role: "viewer",
  });
  assert.equal(second.status, 409);
});

test("creating an account still applies the password policy", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);

  const response = await admin.post("/api/users", {
    email: `${marker}-weak@example.test`,
    full_name: tag("Weak"),
    password: "too-short",
    role: "viewer",
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /at least 12 characters/);
});

test("the user list can be searched by email or name", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const fullName = tag("Findable Person");
  const created = await admin.post("/api/users", {
    email: `${marker}-findable@example.test`,
    full_name: fullName,
    password: "correct-horse-battery-staple-7",
    role: "viewer",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const found = await admin.get(`/api/users?q=${encodeURIComponent(fullName)}`);
  assert.equal(found.status, 200);
  assert.ok(found.body.data.some((row) => row.full_name === fullName));

  const notFound = await admin.get(`/api/users?q=${encodeURIComponent(`${marker}-nobody-called-this`)}`);
  assert.equal(notFound.body.data.length, 0);
});

test("unlock clears a lockout and lets the account sign in again", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const email = `${marker}-locked@example.test`;
  const created = await admin.post("/api/users", {
    email,
    full_name: tag("Locked Out"),
    password: TEST_PASSWORD,
    role: "viewer",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await anonymous.post("/api/auth/login", { email, password: "wrong-password" });
  }
  const stillLocked = await anonymous.post("/api/auth/login", { email, password: TEST_PASSWORD });
  assert.equal(stillLocked.status, 401);

  const unlocked = await admin.patch(`/api/users/${created.body.data.id}`, { unlock: true });
  assert.equal(unlocked.status, 200);

  const { rows } = await pool.query(
    "SELECT locked_until, failed_login_attempts FROM users WHERE id = $1",
    [created.body.data.id],
  );
  assert.equal(rows[0].locked_until, null);
  assert.equal(rows[0].failed_login_attempts, 0);

  const signedIn = await anonymous.post("/api/auth/login", { email, password: TEST_PASSWORD });
  assert.equal(signedIn.status, 200);
});

test("granting a premises that does not exist during a PATCH is refused the same way", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const created = await admin.post("/api/users", {
    email: `${marker}-patchgrant@example.test`,
    full_name: tag("Patch Grant"),
    password: "correct-horse-battery-staple-7",
    role: "viewer",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const response = await admin.patch(`/api/users/${created.body.data.id}`, {
    premises_ids: [999_999_999],
  });
  assert.equal(response.status, 404);
});

test("deactivating an account closes its sessions and stops it signing in again, without deleting it", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);
  const email = `${marker}-deactivated@example.test`;
  const created = await admin.post("/api/users", {
    email,
    full_name: tag("To Deactivate"),
    password: TEST_PASSWORD,
    role: "viewer",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const session = await signIn({ email }, TEST_PASSWORD);
  assert.equal((await session.get("/api/auth/me")).status, 200);

  const deactivated = await admin.delete(`/api/users/${created.body.data.id}`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.is_active, false);
  // Still visible to an admin, unlike a deleted record — the audit trail
  // still refers to a real account.
  assert.equal((await admin.get(`/api/users/${created.body.data.id}`)).status, 200);

  assert.equal((await session.get("/api/auth/me")).status, 401);
  assert.equal(
    (await anonymous.post("/api/auth/refresh", undefined, { headers: { Cookie: session.refreshCookie } }))
      .status,
    401,
  );
  assert.equal((await anonymous.post("/api/auth/login", { email, password: TEST_PASSWORD })).status, 401);
});
