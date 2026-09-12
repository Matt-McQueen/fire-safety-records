// The single place an error becomes a response.
//
// The rule is that a client learns what it needs to correct its request and
// nothing else. An ApiError carries a message written for a caller. Anything
// else is a bug: it is logged in full on the server and answered with a bare
// 500, so a stack trace, a SQL fragment or a connection string can never leave
// the process.

import { config } from "../config/env.js";
import { ApiError } from "./errors.js";
import { translateDatabaseError } from "../db/db.js";
import * as audit from "../audit/auditLog.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No endpoint at ${req.method} ${req.path}`,
      requestId: req.id,
    },
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifies the error
// handler by its four-parameter signature, so `next` must stay.
export function errorHandler(error, req, res, next) {
  const apiError = asApiError(error);

  auditErrorOutcome(apiError, error, req);

  if (res.headersSent) return next(error);

  res.status(apiError.status).json(buildErrorBody(apiError, req, error));
}

// Every 5xx is a failure worth investigating; every 401/403 is a denial worth
// tracking regardless of which endpoint threw it (see errorHandler.js's own
// module comment - this is the one place either outcome is recorded).
function auditErrorOutcome(apiError, error, req) {
  if (apiError.status >= 500) {
    console.error(`[${req.id}] ${req.method} ${req.originalUrl} failed`, error?.stack ?? error);
    audit.record({
      user: req.user,
      action: `${req.method} ${req.originalUrl}`,
      outcome: "failure",
      request: req,
      detail: { message: error?.message },
    });
  } else if (apiError.status === 401 || apiError.status === 403) {
    audit.record({
      user: req.user,
      action: `${req.method} ${req.originalUrl}`,
      outcome: "denied",
      request: req,
      detail: { code: apiError.code, message: apiError.message },
    });
  }
}

function buildErrorBody(apiError, req, error) {
  const body = {
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: req.id,
    },
  };
  if (apiError.details !== undefined) body.error.details = apiError.details;

  // The stack is offered outside production only, and only for a genuine 500 —
  // a debugging aid, never something a deployed instance can be talked into.
  if (!config.isProduction && apiError.status >= 500 && error?.stack) {
    body.error.stack = error.stack.split("\n").slice(0, 8);
  }

  return body;
}

// A flat chain of "does this look like X" translations, each one line and
// independently readable; splitting it into one function per case would
// scatter this security-relevant list (what a raw error is allowed to look
// like to a client) across the file for no reduction in real complexity.
// fallow-ignore-next-line complexity
function asApiError(error) {
  if (error instanceof ApiError) return error;

  // A constraint the domain layer failed to check still has to fail legibly.
  const translated = translateDatabaseError(error);
  if (translated) return translated;

  // express.json rejecting a malformed or oversized body.
  if (error?.type === "entity.parse.failed") {
    return new ApiError(400, "bad_request", "Request body is not valid JSON");
  }
  if (error?.type === "entity.too.large") {
    return new ApiError(413, "payload_too_large", "Request body is too large");
  }
  if (error?.status === 400 && error?.name === "URIError") {
    return new ApiError(400, "bad_request", "Request URL is malformed");
  }

  return new ApiError(500, "internal_error", "Something went wrong handling the request");
}
