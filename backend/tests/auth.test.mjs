// Authentication: sign-in, token rotation, revocation and password change.

import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymous,
  client,
  config,
  makeUser,
  pool,
  refreshCookieFrom,
  signIn,
  TEST_PASSWORD,
} from "./helpers.mjs";

test("health is the only endpoint reachable without a token", async () => {
  const health = await anonymous.get("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");

  for (const path of ["/api/premises", "/api/people", "/api/users", "/api/auth/me"]) {
    const response = await anonymous.get(path);
    assert.equal(response.status, 401, `${path} should require a token`);
  }
});

test("sign-in returns an access token and sets an httpOnly refresh cookie", async () => {
  const account = await makeUser("viewer");
  const response = await anonymous.post("/api/auth/login", {
    email: account.email,
    password: TEST_PASSWORD,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.data.accessToken);
  assert.equal(response.body.data.user.email, account.email);
  // The refresh token must never be readable by script, and must not be in the
  // body where a client could store it somewhere script can read.
  assert.ok(!JSON.stringify(response.body).includes("refreshToken"));

  const cookie = response.cookies.find((value) => value.startsWith("fsr_refresh="));
  assert.ok(cookie, "a refresh cookie should be set");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/auth/i);
});

test("the email is matched without regard to case", async () => {
  const account = await makeUser("viewer");
  const response = await anonymous.post("/api/auth/login", {
    email: account.email.toUpperCase(),
    password: TEST_PASSWORD,
  });
  assert.equal(response.status, 200);
});

test("a wrong password and an unknown account are indistinguishable", async () => {
  const account = await makeUser("viewer");
  const wrongPassword = await anonymous.post("/api/auth/login", {
    email: account.email,
    password: "not-the-right-password-at-all",
  });
  const unknownEmail = await anonymous.post("/api/auth/login", {
    email: "nobody-at-all@example.test",
    password: "not-the-right-password-at-all",
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(wrongPassword.body.error.message, unknownEmail.body.error.message);
});

test("repeated failures lock the account, and the lock is recorded", async () => {
  const account = await makeUser("viewer");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await anonymous.post("/api/auth/login", { email: account.email, password: "wrong-password" });
  }

  // The right password no longer works while the lock stands.
  const locked = await anonymous.post("/api/auth/login", {
    email: account.email,
    password: TEST_PASSWORD,
  });
  assert.equal(locked.status, 401);
  assert.match(locked.body.error.message, /locked/i);

  const { rows } = await pool.query("SELECT failed_login_attempts, locked_until FROM users WHERE id = $1", [
    account.id,
  ]);
  assert.ok(rows[0].failed_login_attempts >= 5);
  assert.ok(rows[0].locked_until);
});

test("an inactive account cannot sign in", async () => {
  const account = await makeUser("viewer");
  await pool.query("UPDATE users SET is_active = FALSE WHERE id = $1", [account.id]);
  const response = await anonymous.post("/api/auth/login", {
    email: account.email,
    password: TEST_PASSWORD,
  });
  assert.equal(response.status, 401);
});

test("deactivating an account invalidates the access token it already holds", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);
  assert.equal((await session.get("/api/auth/me")).status, 200);

  await pool.query("UPDATE users SET is_active = FALSE WHERE id = $1", [account.id]);

  // Checked on every request rather than only at refresh, so removing access is
  // immediate rather than taking effect within the token lifetime.
  const after = await session.get("/api/auth/me");
  assert.equal(after.status, 401);
});

test("refreshing rotates the token, and reusing the old one kills the session", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);

  const first = await anonymous.post("/api/auth/refresh", undefined, {
    headers: { Cookie: session.refreshCookie },
  });
  assert.equal(first.status, 200);
  const rotated = refreshCookieFrom(first);
  assert.ok(rotated);
  assert.notEqual(rotated, session.refreshCookie, "the refresh token should be rotated");

  // The new one works.
  const second = await anonymous.post("/api/auth/refresh", undefined, {
    headers: { Cookie: rotated },
  });
  assert.equal(second.status, 200);

  // Presenting the spent one is treated as theft: the whole chain is revoked.
  const replayed = await anonymous.post("/api/auth/refresh", undefined, {
    headers: { Cookie: session.refreshCookie },
  });
  assert.equal(replayed.status, 401);

  const afterReuse = await anonymous.post("/api/auth/refresh", undefined, {
    headers: { Cookie: refreshCookieFrom(second) },
  });
  assert.equal(afterReuse.status, 401, "the whole token family should be revoked after a reuse");

  const { rows } = await pool.query(
    "SELECT revoked_reason FROM refresh_tokens WHERE user_id = $1 AND revoked_reason = 'reuse_detected'",
    [account.id],
  );
  assert.ok(rows.length > 0, "the reuse should be recorded");
});

test("signing out revokes the refresh token", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);

  const loggedOut = await anonymous.post("/api/auth/logout", undefined, {
    headers: { Cookie: session.refreshCookie },
  });
  assert.equal(loggedOut.status, 204);

  const refreshed = await anonymous.post("/api/auth/refresh", undefined, {
    headers: { Cookie: session.refreshCookie },
  });
  assert.equal(refreshed.status, 401);
});

test("a refresh token from one account cannot be used with another's access token", async () => {
  const [first, second] = await Promise.all([makeUser("viewer"), makeUser("manager")]);
  const firstSession = await signIn(first);
  const secondSession = await signIn(second);

  // The refresh cookie alone decides who is refreshed, so presenting one
  // account's cookie returns that account, never the bearer's.
  const response = await client(secondSession.accessToken).post("/api/auth/refresh", undefined, {
    headers: { Cookie: firstSession.refreshCookie },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.email, first.email);
});

test("changing the password closes every session", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);
  const other = await signIn(account);

  const changed = await session.post("/api/auth/change-password", {
    currentPassword: TEST_PASSWORD,
    newPassword: "a-different-long-passphrase-99",
  });
  assert.equal(changed.status, 204);

  // Both the access token that made the change and one issued to another
  // session stop working.
  assert.equal((await session.get("/api/auth/me")).status, 401);
  assert.equal((await other.get("/api/auth/me")).status, 401);
  assert.equal(
    (await anonymous.post("/api/auth/refresh", undefined, { headers: { Cookie: other.refreshCookie } }))
      .status,
    401,
  );

  const signedInAgain = await anonymous.post("/api/auth/login", {
    email: account.email,
    password: "a-different-long-passphrase-99",
  });
  assert.equal(signedInAgain.status, 200);
});

test("a password change is refused without the current password", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);
  const response = await session.post("/api/auth/change-password", {
    currentPassword: "not-the-current-password",
    newPassword: "a-different-long-passphrase-99",
  });
  assert.equal(response.status, 400);
});

test("a short or obvious new password is refused", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);

  for (const candidate of ["short", "password", TEST_PASSWORD]) {
    const response = await session.post("/api/auth/change-password", {
      currentPassword: TEST_PASSWORD,
      newPassword: candidate,
    });
    assert.equal(response.status, 400, `${candidate} should be refused`);
  }
});

test("a token signed with the wrong key, or tampered with, is refused", async () => {
  const account = await makeUser("viewer");
  const session = await signIn(account);

  const [header, payload, signature] = session.accessToken.split(".");
  const tampered = `${header}.${Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), role: "admin" }),
  ).toString("base64url")}.${signature}`;

  assert.equal((await client(tampered).get("/api/auth/me")).status, 401);

  // alg:none, the classic JWT forgery.
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  )}.${payload}.`;
  assert.equal((await client(unsigned).get("/api/auth/me")).status, 401);
});

test("/api/auth/me reports the role and the premises in scope", async () => {
  const account = await makeUser("assessor");
  const session = await signIn(account);
  const response = await session.get("/api/auth/me");

  assert.equal(response.status, 200);
  assert.equal(response.body.data.role, "assessor");
  assert.deepEqual(response.body.data.premisesIds, []);
  assert.ok(!("passwordHash" in response.body.data));
});

// Last in the file: it lowers the sign-in ceiling for the shared limiter, so
// anything after it would be throttled.
test("repeated sign-in attempts from one address are rate limited", async () => {
  const account = await makeUser("viewer");
  const original = config.rateLimits.loginPerFifteenMinutes;
  config.rateLimits.loginPerFifteenMinutes = 1;
  try {
    let limited = null;
    for (let attempt = 0; attempt < 5 && !limited; attempt += 1) {
      const response = await anonymous.post("/api/auth/login", {
        email: account.email,
        password: "wrong-password-here",
      });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, "the limiter should refuse once the ceiling is passed");
    assert.equal(limited.body.error.code, "too_many_requests");
  } finally {
    config.rateLimits.loginPerFifteenMinutes = original;
  }
});
