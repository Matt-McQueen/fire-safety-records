// Authentication and authorisation middleware.
//
// `authenticate` is mounted once, in front of every route except /api/health
// and /api/auth/login, so an endpoint cannot be reachable unauthenticated by
// being forgotten. `requireRole` and the premises checks then narrow it.

import { forbidden, notFound, unauthorised } from "../http/errors.js";
import { query } from "../db/db.js";
import { passwordEpoch, verifyAccessToken } from "./tokens.js";
import * as audit from "../audit/auditLog.js";

// Ordered from least to most privileged. A check is "is this user at least
// this rank", so a new role slots in by position.
export const ROLES = ["viewer", "assessor", "manager", "admin"];

export function rank(role) {
  const index = ROLES.indexOf(role);
  return index === -1 ? -1 : index;
}

export function atLeast(role, minimum) {
  return rank(role) >= rank(minimum);
}

export async function authenticate(req, res, next) {
  try {
    const header = req.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (!/^Bearer$/i.test(scheme ?? "") || !token) {
      throw unauthorised("An access token is required");
    }

    const claims = verifyAccessToken(token);

    // The token says who is asking; everything that decides what they may do is
    // read here. One query per request buys immediate effect for a role change,
    // a deactivation, a password change and a premises grant alike.
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.person_id, u.is_active,
              u.password_changed_at,
              COALESCE(
                (SELECT array_agg(up.premises_id ORDER BY up.premises_id)
                   FROM user_premises up WHERE up.user_id = u.id),
                '{}'
              ) AS premises_ids
         FROM users u WHERE u.id = $1`,
      [Number(claims.sub)],
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      throw unauthorised("Account is no longer active");
    }
    if (claims.pwd !== passwordEpoch(user.password_changed_at)) {
      throw unauthorised("Password has changed; sign in again");
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.full_name,
      role: user.role,
      personId: user.person_id,
      // Null means unrestricted, which only an admin ever is. An empty array
      // means "no premises granted", which denies everything.
      premisesIds: user.role === "admin" ? null : user.premises_ids,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorised());
    if (!atLeast(req.user.role, minimum)) {
      audit.record({
        user: req.user,
        action: `${req.method} ${req.originalUrl}`,
        outcome: "denied",
        request: req,
        detail: { reason: "insufficient_role", held: req.user.role, needed: minimum },
      });
      return next(
        forbidden(`This action requires the ${minimum} role; your account is ${req.user.role}`),
      );
    }
    next();
  };
}

// Whether a user may touch records belonging to a given premises. An admin
// may touch all of them; everyone else is limited to their grants.
export function mayAccessPremises(user, premisesId) {
  if (!user) return false;
  if (user.premisesIds === null) return true;
  return user.premisesIds.includes(Number(premisesId));
}

// Refusing with 404 rather than 403 for a premises the user cannot see: a 403
// would confirm the record exists, which is itself information about premises
// they have no right to know about. A 403 is used only where the user can see
// the record but not perform the action.
export function assertPremisesAccess(user, premisesId, { reveal = false } = {}) {
  if (mayAccessPremises(user, premisesId)) return;
  throw reveal
    ? forbidden("Your account is not assigned to this premises")
    : notFound();
}

// Loads the premises a user may reach. Called at login and refresh, when the
// claims for the next access token are assembled.
export async function loadPremisesIds(userId, role, client) {
  if (role === "admin") return null;
  const runner = client ?? { query };
  const { rows } = await runner.query(
    "SELECT premises_id FROM user_premises WHERE user_id = $1 ORDER BY premises_id",
    [userId],
  );
  return rows.map((row) => row.premises_id);
}
