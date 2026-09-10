import pg from "pg";

const { Pool, types } = pg;

// Postgres DATE, parsed as a string rather than a JavaScript Date.
//
// By default pg turns a DATE into a Date at local midnight, which JSON then
// serialises in UTC — so 2026-09-30 leaves the API as "2026-09-29T23:00:00Z"
// anywhere east of Greenwich, and a client reading the first ten characters
// gets the wrong day. Every date in this schema is a calendar date, not an
// instant: a check performed on the 30th was performed on the 30th wherever the
// reader is. Handing back the string Postgres stored keeps it that way.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

// TIME (without time zone) has the same problem in reverse: it has no date to
// anchor to, so it is left as the string it is.
const TIME_OID = 1083;
types.setTypeParser(TIME_OID, (value) => value);

// TIMESTAMPTZ is genuinely an instant and is left alone: pg parses it to a Date
// and JSON renders it as an ISO 8601 instant, which is what it is.

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Bounded so a burst of requests queues rather than exhausting the database's
  // connection limit, which on a pooled Supabase project is shared.
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pooled client can fail while idle — the database restarts, the network
// drops. Without a listener that becomes an unhandled 'error' event and takes
// the process down.
pool.on("error", (error) => {
  console.error("Idle database client errored", error.message);
});
