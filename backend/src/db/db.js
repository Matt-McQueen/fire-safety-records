// Database access helpers.
//
// Every query in this codebase goes through `query` or a transaction client
// obtained from `withTransaction`, and every value is passed as a parameter.
// SQL is never assembled from user input: identifiers that vary (sort columns,
// filter columns) are resolved against allowlists declared in the resource
// definitions before they reach a query string.

import { pool } from "./pool.js";
import { conflict, ruleViolation } from "../http/errors.js";

export { pool };

export function query(text, params) {
  return pool.query(text, params);
}

// Runs `work` inside a transaction, committing on return and rolling back on
// any throw. Business rules that read then write — "is there already a current
// assessment for this premises?" — must run inside one of these, so a
// concurrent request cannot slip between the read and the write.
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

// Postgres error codes worth turning into a specific answer. Anything else
// stays a 500: an unexpected database error is a bug in this API, not
// something the client can act on.
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

// The database constraints are the last line of defence, not the first: the
// rules in src/domain check the same things and produce a better message. This
// translation exists so that a rule missed in the domain layer still fails
// safely and legibly rather than as an unexplained 500.
// A flat error-code-to-message lookup; splitting it into one function per
// case would not make any single constraint's translation clearer.
// fallow-ignore-next-line complexity
export function translateDatabaseError(error) {
  switch (error?.code) {
    case FOREIGN_KEY_VIOLATION:
      return conflict(
        "The record refers to something that does not exist, or is still referred to by another record",
        { constraint: error.constraint },
      );
    case UNIQUE_VIOLATION:
      return conflict("A record with those values already exists", {
        constraint: error.constraint,
      });
    case CHECK_VIOLATION:
      return ruleViolation("A value is outside the range the record allows", {
        constraint: error.constraint,
      });
    case NOT_NULL_VIOLATION:
      return ruleViolation(`${error.column ?? "A required field"} must be given`);
    default:
      return null;
  }
}
