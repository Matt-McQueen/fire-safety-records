// Turns a resource definition into an Express router.
//
// Five routes per resource, each one wired to the same permission check, the
// same validation and the same CRUD function. A resource can switch any of
// them off (`operations`) or add its own routes on top (`extend`), but it
// cannot accidentally publish an unguarded one: the role is read from the
// definition and required before the handler runs.

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/asyncHandler.js";
import { requireRole } from "../auth/middleware.js";
import {
  assertNotEmpty,
  idParam,
  validateBody,
  validateParams,
  validateQuery,
} from "../http/validate.js";
import * as crud from "./crud.js";
import { MAX_LIMIT } from "./crud.js";

// Roles used when a definition does not say otherwise. Reading needs an
// account; creating and amending records is the assessor's job; deleting is
// a manager's, because a fire safety record is evidence and removing one
// should not be routine.
const DEFAULT_PERMISSIONS = {
  read: "viewer",
  create: "assessor",
  update: "assessor",
  remove: "manager",
};

export function resourceRouter(definition) {
  const router = Router();
  const permissions = { ...DEFAULT_PERMISSIONS, ...(definition.permissions ?? {}) };
  const operations = definition.operations ?? ["list", "get", "create", "update", "remove"];
  const enabled = new Set(operations);
  const querySchema = buildQuerySchema(definition);

  if (enabled.has("list")) {
    router.get(
      "/",
      requireRole(permissions.read),
      validateQuery(querySchema),
      asyncHandler(async (req, res) => {
        const result = await crud.list(definition, {
          user: req.user,
          query: req.validatedQuery,
        });
        res.json(result);
      }),
    );
  }

  if (enabled.has("get")) {
    router.get(
      "/:id",
      requireRole(permissions.read),
      validateParams(idParam),
      asyncHandler(async (req, res) => {
        const row = await crud.get(definition, req.validatedParams.id, { user: req.user });
        res.json({ data: row });
      }),
    );
  }

  if (enabled.has("create")) {
    router.post(
      "/",
      requireRole(permissions.create),
      validateBody(definition.schemas.create),
      asyncHandler(async (req, res) => {
        const row = await crud.create(definition, req.body, {
          user: req.user,
          request: req,
        });
        res.status(201).location(`${req.baseUrl}/${row.id}`).json({ data: row });
      }),
    );
  }

  if (enabled.has("update")) {
    // PATCH, not PUT: these records are amended field by field, and a PUT that
    // silently blanks the columns a client forgot to send is the wrong default
    // for a compliance record.
    router.patch(
      "/:id",
      requireRole(permissions.update),
      validateParams(idParam),
      validateBody(definition.schemas.update),
      asyncHandler(async (req, res) => {
        assertNotEmpty(req.body);
        const row = await crud.update(definition, req.validatedParams.id, req.body, {
          user: req.user,
          request: req,
        });
        res.json({ data: row });
      }),
    );
  }

  if (enabled.has("remove")) {
    router.delete(
      "/:id",
      requireRole(permissions.remove),
      validateParams(idParam),
      asyncHandler(async (req, res) => {
        await crud.remove(definition, req.validatedParams.id, {
          user: req.user,
          request: req,
        });
        res.status(204).end();
      }),
    );
  }

  definition.extend?.(router, { definition, permissions });

  return router;
}

// The query schema is derived from the filters the definition declares, so a
// parameter that is not declared is rejected rather than ignored. That turns a
// typo in a client's filter — which would otherwise return every row — into a
// 400.
function buildQuerySchema(definition) {
  const shape = {
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  };

  const sortable = Object.keys(definition.sortable ?? { id: "t.id" });
  shape.sort = z.enum(sortable).optional();

  if (definition.search?.length) {
    shape.q = z.string().trim().min(1).max(200).optional();
  }

  for (const filter of definition.filters ?? []) {
    shape[filter.param] = filter.schema;
  }

  for (const range of definition.dateRanges ?? []) {
    shape[`${range.param}_from`] = range.schema;
    shape[`${range.param}_to`] = range.schema;
  }

  return z.strictObject(shape);
}
