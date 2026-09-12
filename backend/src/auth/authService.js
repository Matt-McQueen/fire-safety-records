// The authentication flows themselves.
//
// Login, refresh, logout and password change. Everything that touches a
// credential lives here; the routes only translate HTTP to and from it.

import crypto from "node:crypto";
import { config } from "../config/env.js";
import { withTransaction, query } from "../db/db.js";
import { badRequest, unauthorised } from "../http/errors.js";
import * as audit from "../audit/auditLog.js";
import {
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./passwords.js";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "./tokens.js";
import { loadPremisesIds } from "./middleware.js";

// A hash of a value no one holds. Verified against when the email is unknown,
// so a request for a non-existent account costs the same time as a request
// with a wrong password and the two cannot be told apart.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(32).toString("hex"));

// Deliberately the same message for an unknown email, a wrong password and a
// deactivated account. Which of the three it was is in the audit trail, not in
// the response.
const REJECTED = "Email or password is not recognised";

// Kept as one block rather than split into named guards: the rejection order
// and the dummy-hash comparison on an unknown email are a deliberate
// timing-attack mitigation (see DUMMY_HASH above), and this is the one place
// that sequence needs to be read and audited as a whole.
// fallow-ignore-next-line complexity
export async function login({ email, password, request }) {
  const { rows } = await query(
    `SELECT id, email, full_name, role, person_id, is_active, password_hash,
            failed_login_attempts, locked_until, password_changed_at
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    await audit.record({
      action: "auth.login",
      outcome: "failure",
      request,
      detail: { email, reason: "unknown_email" },
    });
    throw unauthorised(REJECTED);
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit.record({
      user,
      action: "auth.login",
      outcome: "denied",
      request,
      detail: { reason: "locked", until: user.locked_until },
    });
    // Being told the account is locked is worth more to the account holder
    // than to an attacker, who has already learned it by being locked out.
    throw unauthorised(
      "Account is temporarily locked after repeated failed sign-ins. Try again later.",
    );
  }

  const correct = await verifyPassword(password, user.password_hash);

  if (!correct || !user.is_active) {
    await registerFailure(user);
    await audit.record({
      user,
      action: "auth.login",
      outcome: "failure",
      request,
      detail: { reason: user.is_active ? "wrong_password" : "inactive_account" },
    });
    throw unauthorised(REJECTED);
  }

  return withTransaction(async (client) => {
    // The cost may have been raised since this password was set. The plaintext
    // is in hand exactly once, at a successful login, so that is when an old
    // hash is quietly upgraded.
    if (needsRehash(user.password_hash)) {
      await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
        user.id,
        await hashPassword(password),
      ]);
    }

    await client.query(
      `UPDATE users
          SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
        WHERE id = $1`,
      [user.id],
    );

    const session = await issueSession(client, user, {
      request,
      familyId: crypto.randomUUID(),
    });

    await audit.record({ user, action: "auth.login", outcome: "success", request }, client);

    return session;
  });
}

// Exchanges a refresh token for a new pair, rotating the old one out.
//
// Refusing a refresh usually means revoking something, and a revocation must
// survive the refusal. Throwing from inside the transaction would roll the
// revocation back along with everything else — so the transaction decides what
// happened and returns it, and the refusal, with its revocation, is carried out
// afterwards on a connection of its own.
export async function refresh({ token, request }) {
  if (!token) throw unauthorised("No refresh token was presented");

  const outcome = await withTransaction(async (client) => {
    // FOR UPDATE serialises concurrent refreshes on the same token, so two
    // requests racing with one token cannot both succeed; the loser finds the
    // row already revoked and is treated as reuse.
    const { rows } = await client.query(
      `SELECT id, user_id, family_id, expires_at, revoked_at
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashRefreshToken(token)],
    );
    const existing = rows[0];

    if (!existing) return { kind: "unknown_token" };
    if (existing.revoked_at) return { kind: "reuse", token: existing };
    if (new Date(existing.expires_at) <= new Date()) return { kind: "expired", token: existing };

    const { rows: userRows } = await client.query(
      `SELECT id, email, full_name, role, person_id, is_active, password_changed_at
         FROM users WHERE id = $1`,
      [existing.user_id],
    );
    const user = userRows[0];
    if (!user || !user.is_active) return { kind: "inactive", token: existing };

    // Reusing the family id keeps the whole chain from one login revocable
    // together. Refreshing here is also where a changed role or a new premises
    // grant reaches the client.
    const session = await issueSession(client, user, {
      request,
      familyId: existing.family_id,
      replaces: existing.id,
    });

    await audit.record({ user, action: "auth.refresh", outcome: "success", request }, client);

    return { kind: "ok", session };
  });

  if (outcome.kind === "ok") return outcome.session;

  switch (outcome.kind) {
    case "unknown_token":
      await audit.record({
        action: "auth.refresh",
        outcome: "failure",
        request,
        detail: { reason: "unknown_token" },
      });
      throw unauthorised("Refresh token is not valid");

    // A token that was already rotated is being presented a second time. The
    // legitimate holder has exactly one token; anyone presenting a spent one
    // either stole it or had theirs stolen. Either way the whole chain from
    // that login is killed and both parties must sign in again.
    case "reuse":
      await query(
        `UPDATE refresh_tokens
            SET revoked_at = now(), revoked_reason = 'reuse_detected'
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [outcome.token.family_id],
      );
      await audit.record({
        user: { id: outcome.token.user_id },
        action: "auth.refresh",
        outcome: "denied",
        request,
        detail: { reason: "token_reuse", familyId: outcome.token.family_id },
      });
      throw unauthorised("Refresh token has already been used; sign in again");

    case "expired":
      await query(
        "UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'expired' WHERE id = $1",
        [outcome.token.id],
      );
      throw unauthorised("Refresh token has expired; sign in again");

    default:
      await query(
        `UPDATE refresh_tokens
            SET revoked_at = now(), revoked_reason = 'account_inactive'
          WHERE id = $1`,
        [outcome.token.id],
      );
      throw unauthorised("Account is no longer active");
  }
}

export async function logout({ token, user, request, everywhere = false }) {
  if (everywhere && user) {
    await query(
      `UPDATE refresh_tokens
          SET revoked_at = now(), revoked_reason = 'logout_all'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
  } else if (token) {
    await query(
      `UPDATE refresh_tokens
          SET revoked_at = now(), revoked_reason = 'logout'
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashRefreshToken(token)],
    );
  }
  await audit.record({ user, action: "auth.logout", request, detail: { everywhere } });
}

export async function changePassword({ user, currentPassword, newPassword, request }) {
  const { rows } = await query(
    "SELECT password_hash, email, full_name FROM users WHERE id = $1",
    [user.id],
  );
  const account = rows[0];
  if (!account) throw unauthorised();

  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    await audit.record({
      user,
      action: "auth.password_change",
      outcome: "failure",
      request,
      detail: { reason: "wrong_current_password" },
    });
    throw badRequest("Current password is not correct");
  }

  if (currentPassword === newPassword) {
    throw badRequest("New password must be different from the current one");
  }
  assertPasswordAcceptable(newPassword, { email: account.email, fullName: account.full_name });

  await withTransaction(async (client) => {
    // Moving password_changed_at invalidates every outstanding access token
    // for this user, and revoking the refresh tokens closes every session.
    // Changing a password therefore signs the account out everywhere, which is
    // what someone changing it because they fear compromise expects.
    await client.query(
      `UPDATE users
          SET password_hash = $2, password_changed_at = now(), updated_at = now()
        WHERE id = $1`,
      [user.id, await hashPassword(newPassword)],
    );
    await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now(), revoked_reason = 'password_changed'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await audit.record({ user, action: "auth.password_change", request }, client);
  });
}

// Issues an access token and a fresh refresh token, recording the latter.
async function issueSession(client, user, { request, familyId, replaces }) {
  const premisesIds = await loadPremisesIds(user.id, user.role, client);
  const refreshToken = createRefreshToken();
  const expiresAt = refreshTokenExpiry();

  const { rows } = await client.query(
    `INSERT INTO refresh_tokens
       (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      user.id,
      refreshToken.hash,
      familyId,
      expiresAt,
      request?.get?.("user-agent")?.slice(0, 400) ?? null,
      request?.ip ?? null,
    ],
  );

  if (replaces) {
    await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now(), revoked_reason = 'rotated', replaced_by_id = $2
        WHERE id = $1`,
      [replaces, rows[0].id],
    );
  }

  return {
    accessToken: signAccessToken(user),
    refreshToken: refreshToken.token,
    expiresIn: config.auth.accessTokenTtl,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      personId: user.person_id ?? null,
      premisesIds,
    },
  };
}

// Counts a failed attempt and locks the account once the threshold is reached.
async function registerFailure(user) {
  const { maxFailedLogins, lockoutMinutes } = config.auth;
  await query(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2
                THEN now() + make_interval(mins => $3)
              ELSE locked_until
            END
      WHERE id = $1`,
    [user.id, maxFailedLogins, lockoutMinutes],
  );
}
