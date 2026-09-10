// The error vocabulary the whole API speaks.
//
// Anything thrown that is not an ApiError is treated as a bug: it is logged in
// full and reported to the client as a bare 500. That way a stack trace, a
// Postgres error string or a constraint name can never reach a client.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, "bad_request", message, details);

export const unauthorised = (message = "Authentication is required") =>
  new ApiError(401, "unauthorised", message);

export const forbidden = (message = "You do not have access to this record") =>
  new ApiError(403, "forbidden", message);

export const notFound = (message = "Record not found") =>
  new ApiError(404, "not_found", message);

export const conflict = (message, details) =>
  new ApiError(409, "conflict", message, details);

// A business rule refused the change. Distinguished from a plain 409 so a
// client can tell "this clashes with another record" from "the rules of the
// domain do not allow this", and from 400, which means the request was
// malformed rather than disallowed.
export const ruleViolation = (message, details) =>
  new ApiError(422, "rule_violation", message, details);

export const tooManyRequests = (message = "Too many requests") =>
  new ApiError(429, "too_many_requests", message);
