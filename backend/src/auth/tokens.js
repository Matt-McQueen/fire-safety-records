// Access and refresh tokens.
//
// Access token: a short-lived HS256 JWT the client keeps in memory and sends
// as `Authorization: Bearer`. It identifies the account and nothing more.
//
// Refresh token: 32 random bytes, never a JWT. It is sent only in an httpOnly,
// SameSite=Strict cookie scoped to /api/auth, and only its SHA-256 hash is
// stored, so a database disclosure does not hand over usable sessions.
//
// Deliberately, the token does NOT carry the role or the premises the account
// may reach. Those are read from the database on every request instead. Putting
// them in the token would save a query and make every grant a snapshot: an
// account demoted or narrowed would keep its old reach until the token expired,
// and a premises created a moment ago would be invisible to the person who
// created it. Authority comes from the tables, and the token only says who is
// asking.

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { unauthorised } from "../http/errors.js";

export function signAccessToken(user) {
  return jwt.sign(
    {
      email: user.email,
      // Present so a client can render "signed in as" without another call.
      // Not trusted by the API, which reads the account for itself.
      name: user.full_name,
      pwd: passwordEpoch(user.password_changed_at),
    },
    config.auth.secret,
    {
      subject: String(user.id),
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      expiresIn: config.auth.accessTokenTtl,
      algorithm: "HS256",
    },
  );
}

export function verifyAccessToken(token) {
  try {
    // `algorithms` is pinned so a token claiming alg:none or a different
    // algorithm cannot be presented as valid.
    const claims = jwt.verify(token, config.auth.secret, {
      algorithms: ["HS256"],
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
    return claims;
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      throw unauthorised("Access token has expired");
    }
    throw unauthorised("Access token is not valid");
  }
}

// Milliseconds, not the seconds a JWT normally deals in. At second resolution
// a token issued in the same second as a password change would still carry a
// matching value and survive it, which is precisely the case the check exists
// for.
export function passwordEpoch(changedAt) {
  return new Date(changedAt).getTime();
}

export function createRefreshToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  // A plain SHA-256 rather than a password hash: the token is 256 bits of
  // randomness, so there is nothing to guess and nothing for a slow hash to buy.
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(from = new Date()) {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + config.auth.refreshTokenDays);
  return expires;
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.auth.secureCookies,
    // Strict: the cookie is never attached to a cross-site request, so no
    // other origin can drive a refresh even if it can make the browser issue
    // one. This is what removes the need for a separate CSRF token — the
    // cookie is the only credential sent automatically, and it only unlocks
    // /api/auth/refresh.
    sameSite: "strict",
    path: config.auth.cookiePath,
    maxAge: config.auth.refreshTokenDays * 24 * 60 * 60 * 1000,
  };
}
