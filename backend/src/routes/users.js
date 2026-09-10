// /api/users — account administration. Admin only, throughout.
//
// Creating accounts, changing roles and granting premises access are the levers
// that decide who can see personal data about who is at particular risk in a
// fire. They are kept in one place, behind one role, and every one of them is
// audited.

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/asyncHandler.js";
import { authenticate, requireRole, ROLES } from "../auth/middleware.js";
import { conflict, notFound, ruleViolation } from "../http/errors.js";
import { pool, withTransaction } from "../db/db.js";
import * as audit from "../audit/auditLog.js";
import { assertPasswordAcceptable, hashPassword } from "../auth/passwords.js";
import {
  email,
  id,
  idParam,
  optionalId,
  requiredText,
  validateBody,
  validateParams,
  validateQuery,
} from "../http/validate.js";

export const usersRouter = Router();

// Belt and braces: the router is mounted behind the global `authenticate`, and
// says so again here so that it cannot be remounted somewhere open by accident.
usersRouter.use(authenticate, requireRole("admin"));

// The columns a user is ever described by. password_hash is not among them, so
// no handler can leak it by widening a SELECT.
const PUBLIC_COLUMNS = `
  u.id, u.email, u.full_name, u.role, u.person_id, u.is_active,
  u.last_login_at, u.locked_until, u.created_at, u.updated_at`;

usersRouter.get(
  "/",
  validateQuery(
    z.strictObject({
      role: z.enum(ROLES).optional(),
      is_active: z.enum(["true", "false"]).optional(),
      q: z.string().trim().min(1).max(200).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { role, is_active: isActive, q, limit = 50, offset = 0 } = req.validatedQuery;
    const where = [];
    const params = [];
    const push = (value) => `$${params.push(value)}`;

    if (role) where.push(`u.role = ${push(role)}`);
    if (isActive !== undefined) where.push(`u.is_active = ${push(isActive === "true")}`);
    if (q) {
      const pattern = push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(u.email ILIKE ${pattern} ESCAPE '\\' OR u.full_name ILIKE ${pattern} ESCAPE '\\')`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS},
              COALESCE(
                (SELECT array_agg(up.premises_id ORDER BY up.premises_id)
                   FROM user_premises up WHERE up.user_id = u.id),
                '{}'
              ) AS premises_ids
         FROM users u
         ${whereSql}
        ORDER BY u.email
        LIMIT ${push(limit)} OFFSET ${push(offset)}`,
      params,
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total FROM users u ${whereSql}`,
      params.slice(0, params.length - 2),
    );

    res.json({ data: rows, page: { limit, offset, total: countRows[0].total } });
  }),
);

usersRouter.get(
  "/:id",
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json({ data: await loadUser(req.validatedParams.id) });
  }),
);

usersRouter.post(
  "/",
  validateBody(
    z.strictObject({
      email,
      full_name: requiredText(200),
      password: z.string().min(1).max(200),
      role: z.enum(ROLES),
      person_id: optionalId,
      // Which premises the account may reach. An account created with none can
      // read nothing until it is granted some, which is the safe default.
      premises_ids: z.array(id).max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { password, premises_ids: premisesIds = [], ...fields } = req.body;
    assertPasswordAcceptable(password, { email: fields.email, fullName: fields.full_name });

    const created = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1)",
        [fields.email],
      );
      if (existing.length > 0) {
        throw conflict("An account with that email address already exists");
      }

      const { rows } = await client.query(
        `INSERT INTO users (email, full_name, password_hash, role, person_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          fields.email,
          fields.full_name,
          await hashPassword(password),
          fields.role,
          fields.person_id ?? null,
        ],
      );
      const userId = rows[0].id;

      await grantPremises(client, userId, premisesIds, req.user.id);

      await audit.record(
        {
          user: req.user,
          action: "users.create",
          resource: "users",
          resourceId: userId,
          request: req,
          detail: { email: fields.email, role: fields.role, premises_ids: premisesIds },
        },
        client,
      );
      return userId;
    });

    res.status(201).location(`${req.baseUrl}/${created}`).json({ data: await loadUser(created) });
  }),
);

usersRouter.patch(
  "/:id",
  validateParams(idParam),
  validateBody(
    z.strictObject({
      full_name: requiredText(200).optional(),
      role: z.enum(ROLES).optional(),
      person_id: optionalId,
      is_active: z.boolean().optional(),
      // Replaces the whole set rather than adding to it, so a grant list is
      // always exactly what was intended.
      premises_ids: z.array(id).max(500).optional(),
      // Clears a lockout after repeated failed sign-ins.
      unlock: z.literal(true).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const userId = req.validatedParams.id;
    const before = await loadUser(userId);

    await withTransaction(async (client) => {
      const { premises_ids: premisesIds, unlock, ...fields } = req.body;

      // An admin who demotes or deactivates their own account would lock
      // everyone out of user administration if they were the last one.
      if (userId === req.user.id && (fields.role !== undefined || fields.is_active === false)) {
        await assertNotLastAdmin(client, userId);
      }
      if (before.role === "admin" && fields.role !== undefined && fields.role !== "admin") {
        await assertNotLastAdmin(client, userId);
      }

      const assignments = [];
      const params = [userId];
      for (const [column, value] of Object.entries(fields)) {
        assignments.push(`${column} = $${params.push(value)}`);
      }
      if (unlock) {
        assignments.push("locked_until = NULL", "failed_login_attempts = 0");
      }
      if (assignments.length > 0) {
        await client.query(
          `UPDATE users SET ${assignments.join(", ")}, updated_at = now() WHERE id = $1`,
          params,
        );
      }

      if (premisesIds !== undefined) {
        await client.query("DELETE FROM user_premises WHERE user_id = $1", [userId]);
        await grantPremises(client, userId, premisesIds, req.user.id);
      }

      // Losing a role or a premises only takes effect at the next refresh,
      // because the access token already issued carries the old claims. For a
      // change that removes access, the sessions are closed so it is immediate.
      const narrowing =
        fields.is_active === false ||
        (fields.role !== undefined && fields.role !== before.role) ||
        premisesIds !== undefined;
      if (narrowing) {
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'access_changed'
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
      }

      await audit.record(
        {
          user: req.user,
          action: "users.update",
          resource: "users",
          resourceId: userId,
          request: req,
          detail: {
            changed: audit.changedFields(before, fields),
            premises_ids: premisesIds,
            unlocked: unlock ?? false,
            sessions_revoked: narrowing,
          },
        },
        client,
      );
    });

    res.json({ data: await loadUser(userId) });
  }),
);

// Deactivation rather than deletion: the audit trail refers to the account, and
// an account that is gone makes the trail harder to read. A deleted user's
// audit rows survive by design (user_id becomes NULL, user_email remains), but
// deactivating keeps the whole history intact and is reversible.
usersRouter.delete(
  "/:id",
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const userId = req.validatedParams.id;
    await loadUser(userId);

    await withTransaction(async (client) => {
      await assertNotLastAdmin(client, userId);
      await client.query(
        "UPDATE users SET is_active = FALSE, updated_at = now() WHERE id = $1",
        [userId],
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'account_deactivated'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await audit.record(
        {
          user: req.user,
          action: "users.deactivate",
          resource: "users",
          resourceId: userId,
          request: req,
        },
        client,
      );
    });

    res.json({ data: await loadUser(userId) });
  }),
);

// The audit trail. Admin only, and read only: there is no endpoint that writes
// to it directly and none that deletes from it.
usersRouter.get(
  "/audit/log",
  validateQuery(
    z.strictObject({
      user_id: id.optional(),
      premises_id: id.optional(),
      resource: z.string().max(64).optional(),
      action: z.string().max(64).optional(),
      outcome: z.enum(["success", "denied", "failure"]).optional(),
      since: z.iso.datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { limit = 100, offset = 0, since, ...filters } = req.validatedQuery;
    const where = [];
    const params = [];
    const push = (value) => `$${params.push(value)}`;

    for (const [column, value] of Object.entries(filters)) {
      if (value !== undefined) where.push(`${column} = ${push(value)}`);
    }
    if (since) where.push(`occurred_at >= ${push(since)}`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT * FROM audit_log ${whereSql}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${push(limit)} OFFSET ${push(offset)}`,
      params,
    );
    res.json({ data: rows, page: { limit, offset } });
  }),
);

async function loadUser(userId) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS},
            COALESCE(
              (SELECT array_agg(up.premises_id ORDER BY up.premises_id)
                 FROM user_premises up WHERE up.user_id = u.id),
              '{}'
            ) AS premises_ids
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) throw notFound(`User ${userId} was not found`);
  return rows[0];
}

async function grantPremises(client, userId, premisesIds, grantedBy) {
  if (!premisesIds || premisesIds.length === 0) return;

  const unique = [...new Set(premisesIds)];
  const { rows } = await client.query("SELECT id FROM premises WHERE id = ANY($1)", [unique]);
  const found = new Set(rows.map((row) => row.id));
  const missing = unique.filter((premisesId) => !found.has(premisesId));
  if (missing.length > 0) {
    throw notFound(`Premises not found: ${missing.join(", ")}`);
  }

  await client.query(
    `INSERT INTO user_premises (user_id, premises_id, granted_by)
     SELECT $1, unnest($2::int[]), $3
     ON CONFLICT DO NOTHING`,
    [userId, unique, grantedBy],
  );
}

// Locking every admin out of the system is not recoverable through the API, so
// the last active one cannot be demoted, deactivated or removed.
async function assertNotLastAdmin(client, userId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS remaining
       FROM users
      WHERE role = 'admin' AND is_active AND id <> $1`,
    [userId],
  );
  if (rows[0].remaining === 0) {
    throw ruleViolation(
      "This is the only active admin account. Promote another account to admin before changing this one.",
    );
  }
}
