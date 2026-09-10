// Request validation.
//
// Nothing reaches a service or a query without passing through a schema first.
// Schemas are strict objects, so an unrecognised field is an error rather than
// something silently dropped: a client that misspells `carried_out_on` is told
// so instead of quietly writing a record with the field missing.
//
// The shared field types live here too. Getting a date or an identifier wrong
// in one place and right in twenty others is how validation gaps happen, so
// there is one definition of each.

import { z } from "zod";
import { badRequest } from "./errors.js";

export { z };

// --- shared field types ----------------------------------------------------

export const id = z.coerce.number().int().positive();

// Postgres DATE. Rejects 2025-02-30 as well as malformed input.
export const isoDate = z.iso.date();

export const isoDateTime = z.iso.datetime({ offset: true });

// Free text. Trimmed, and capped so a single field cannot be used to push
// megabytes into the record. The ceiling is generous: a risk assessment
// summary or a procedure is genuinely long.
export const text = (max = 4000) => z.string().trim().max(max);

export const requiredText = (max = 4000) => text(max).min(1, "Must not be empty");

export const optionalText = (max = 4000) =>
  text(max)
    .optional()
    .nullable()
    // An empty string from a cleared form field means "no value", not "".
    .transform((value) => (value === "" ? null : value));

export const flag = z.boolean();

export const count = z.coerce.number().int().min(0);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Must be an email address");

// UK postcode, loosely: the format is checked, not whether the postcode exists.
export const postcode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/, "Must be a UK postcode")
  .transform((value) => (value.includes(" ") ? value : `${value.slice(0, -3)} ${value.slice(-3)}`));

export const optionalPostcode = postcode.optional().nullable();

// A nullable foreign key. `null` clears it; a value must be a positive integer.
export const optionalId = id.optional().nullable();

// --- middleware ------------------------------------------------------------

// Validates `req.body`, replacing it with the parsed value so downstream code
// works with coerced, trimmed, known-shaped data rather than raw JSON.
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(validationError(result.error));
  req.body = result.data;
  next();
};

// Express 5 makes req.query a getter, so the parsed value is put somewhere
// else rather than assigned over it.
export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) return next(validationError(result.error));
  req.validatedQuery = result.data;
  next();
};

export const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params ?? {});
  if (!result.success) return next(validationError(result.error));
  req.validatedParams = result.data;
  next();
};

// The single numeric path parameter almost every route has.
export const idParam = z.strictObject({ id });

export function validationError(error) {
  return badRequest("The request did not pass validation", {
    fields: error.issues.map((issue) => ({
      field: issue.path.join(".") || "(body)",
      message: issue.message,
    })),
  });
}

// Query strings carry text, so a boolean filter accepts the spellings a client
// is likely to send rather than only JSON's `true`.
export function booleanParam() {
  return z
    .enum(["true", "false", "1", "0"])
    .transform((value) => value === "true" || value === "1")
    .optional();
}

// A PATCH body is partial, but a field that is present must still be valid.
export function partial(fields) {
  const result = {};
  for (const [key, schema] of Object.entries(fields)) {
    result[key] = schema.optional();
  }
  return result;
}

// Fields that may be set when a record is created but not changed afterwards —
// which premises a record belongs to, or which person a role is held by.
// Changing those would move the record rather than amend it.
export function omit(fields, keys) {
  const result = {};
  for (const [key, schema] of Object.entries(fields)) {
    if (!keys.includes(key)) result[key] = schema;
  }
  return result;
}

// Used by PATCH handlers: a partial update with no recognised field is a
// mistake worth reporting rather than a no-op that returns 200.
export function assertNotEmpty(body) {
  if (!body || Object.keys(body).length === 0) {
    throw badRequest("No fields to update were given");
  }
  return body;
}
