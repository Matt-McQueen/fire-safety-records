// Unit tests for auth/tokens.js: signing and verifying the access token, and
// the refresh token's shape. No database and no server — just JWTs and
// crypto.randomBytes, exercised directly against the config this process
// starts with (a random JWT secret outside production; see config/env.js).

import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { config } from "../../src/config/env.js";
import {
  createRefreshToken,
  hashRefreshToken,
  passwordEpoch,
  refreshCookieOptions,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from "../../src/auth/tokens.js";
import { ApiError } from "../../src/http/errors.js";

const user = {
  id: 7,
  email: "jsmith@example.test",
  full_name: "J Smith",
  password_changed_at: "2026-01-01T00:00:00.000Z",
};

test("signAccessToken produces a token verifyAccessToken accepts, carrying the subject and claims", () => {
  const token = signAccessToken(user);
  const claims = verifyAccessToken(token);

  assert.equal(claims.sub, "7");
  assert.equal(claims.email, user.email);
  assert.equal(claims.name, user.full_name);
  assert.equal(claims.pwd, passwordEpoch(user.password_changed_at));
  assert.equal(claims.iss, config.auth.issuer);
  assert.equal(claims.aud, config.auth.audience);
});

test("verifyAccessToken refuses a token signed with a different key", () => {
  const foreign = jwt.sign({ sub: "7" }, "a-completely-different-secret-key-value", {
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    algorithm: "HS256",
  });

  assert.throws(() => verifyAccessToken(foreign), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    return true;
  });
});

test("verifyAccessToken refuses an expired token, and says so", () => {
  const expired = jwt.sign({ sub: "7" }, config.auth.secret, {
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    algorithm: "HS256",
    expiresIn: -10,
  });

  assert.throws(() => verifyAccessToken(expired), /expired/i);
});

test("verifyAccessToken refuses a token for the wrong audience or issuer", () => {
  const wrongAudience = jwt.sign({ sub: "7" }, config.auth.secret, {
    issuer: config.auth.issuer,
    audience: "someone-elses-api",
    algorithm: "HS256",
  });
  assert.throws(() => verifyAccessToken(wrongAudience));

  const wrongIssuer = jwt.sign({ sub: "7" }, config.auth.secret, {
    issuer: "someone-else",
    audience: config.auth.audience,
    algorithm: "HS256",
  });
  assert.throws(() => verifyAccessToken(wrongIssuer));
});

test("verifyAccessToken refuses alg:none, the classic JWT forgery", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "7", iss: config.auth.issuer, aud: config.auth.audience }),
  ).toString("base64url");
  const forged = `${header}.${payload}.`;

  assert.throws(() => verifyAccessToken(forged));
});

test("passwordEpoch is the millisecond timestamp of the password change, so a stale token can be told apart", () => {
  const epoch = passwordEpoch("2026-01-01T00:00:00.000Z");
  assert.equal(epoch, Date.parse("2026-01-01T00:00:00.000Z"));

  const before = signAccessToken(user);
  const changed = signAccessToken({ ...user, password_changed_at: "2026-06-01T00:00:00.000Z" });
  assert.notEqual(verifyAccessToken(before).pwd, verifyAccessToken(changed).pwd);
});

test("createRefreshToken returns a random token and its hash, and the hash is reproducible", () => {
  const first = createRefreshToken();
  const second = createRefreshToken();

  assert.notEqual(first.token, second.token, "two calls should not collide");
  assert.equal(first.hash, hashRefreshToken(first.token));
  assert.notEqual(first.hash, second.hash);
  // 32 random bytes, base64url-encoded, are 43 characters (no padding).
  assert.equal(first.token.length, 43);
});

test("hashRefreshToken is deterministic and does not reveal the token", () => {
  const token = "some-fixed-token-value";
  const hash = hashRefreshToken(token);
  assert.equal(hash, hashRefreshToken(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(token));
});

test("refreshTokenExpiry adds the configured number of days to the given instant", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const expiry = refreshTokenExpiry(from);
  const expectedDays = config.auth.refreshTokenDays;

  const diffDays = Math.round((expiry.getTime() - from.getTime()) / 86_400_000);
  assert.equal(diffDays, expectedDays);
});

test("refreshCookieOptions sets the flags a refresh cookie needs: httpOnly, SameSite=Strict, scoped path", () => {
  const options = refreshCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.path, config.auth.cookiePath);
  assert.equal(options.secure, config.auth.secureCookies);
  assert.equal(options.maxAge, config.auth.refreshTokenDays * 24 * 60 * 60 * 1000);
});
