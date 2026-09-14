// Refuses to let a writing test suite run against a database that has been
// named as one to protect.
//
// Both suites that use this create premises, people and accounts directly and
// delete them afterwards. That is safe against a disposable database and not
// safe against a live one: an interrupted run leaves real-looking records
// behind, in a database that holds personal data. Nothing about the two suites
// says which database they are pointed at — `DATABASE_URL` does, and it is a
// line in a `.env` file that is easy to leave pointing somewhere it shouldn't.
//
// Two ways to say a database is off limits, and either is enough:
//
//   PROTECTED_DATABASE_HOSTS   comma-separated hostnames, matched exactly or
//                              as a suffix. Set this in backend/.env with the
//                              production host in it. Deliberately not
//                              committed: the hostname is not a secret but it
//                              is not the repository's business either.
//   APP_ENVIRONMENT=production the same signal the API reports from
//                              /api/health.
//
// This is a guard, not a permission system — anyone who wants to get past it
// can. The point is that getting past it has to be a decision.

export function assertDisposableDatabase(suiteName) {
  const url = process.env.DATABASE_URL ?? "";
  const host = hostOf(url);

  const protectedHosts = (process.env.PROTECTED_DATABASE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const named = host !== null && protectedHosts.some((entry) => host === entry || host.endsWith(entry));
  const flagged = (process.env.APP_ENVIRONMENT ?? "").trim().toLowerCase() === "production";

  if (!named && !flagged) return;

  console.error(
    [
      "",
      `Refusing to run ${suiteName} against ${host ?? "this database"}.`,
      "",
      named
        ? "  It is listed in PROTECTED_DATABASE_HOSTS."
        : "  APP_ENVIRONMENT is set to production.",
      "",
      "  This suite writes to the database it is given. Point DATABASE_URL at a",
      "  local Postgres or at the staging database and run it again. To check a",
      "  production deployment, use the read-only suite in smoke/ instead.",
      "",
    ].join("\n"),
  );
  // Thrown rather than exited: this runs inside a test runner, and a runner
  // that reports a failed run is clearer than a process that vanishes.
  throw new Error(`Refusing to run ${suiteName} against a protected database`);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
