# Working rules for Claude

[README.md](README.md) is the source of truth for how this project is built,
deployed and tested. This file is the short list of rules that must not be
missed in a session that never thought to go looking for them — a one-line fix
at 5pm is still a change, and takes the same route as any other.

Read [*Making a change*](README.md#making-a-change) before touching anything
that will be deployed. What follows is the summary, not a replacement for it.

## Every change takes the same route

1. **Branch off `staging`.**
2. **Make the change.** Schema changes are migration files in
   [`backend/src/db/migrations/`](backend/src/db/migrations/README.md), each with
   a `.down.sql`.
3. **Prove it locally** — `backend` `npm test`, `frontend` `npm run lint && npm test && npm run build`,
   `e2e` `npm test`, then Fallow over the diff. All of it *before* the pull
   request; a deployed environment is a poor place to discover something does
   not compile.
4. **Open the pull request against `staging`**, with those results in the
   description. ← **Human gate: it waits for Matt's review.**
5. **Merge to `staging`** — migration applied to the staging database first,
   then wait for the deploy to land (`smoke/wait-for-deploy.mjs`, pinned to the
   commit) before testing it.
6. **Run the suites against staging.**
7. **Hand it over.** ← **Human gate: Matt tests staging himself.** Staging is
   where a change is looked at by a person, not where it is debugged.
8. **Promote, once he has approved** — backup first, env vars set in Render,
   Vercel and Pages *before* the deploy lands, then open a pull request from
   `staging` into `main` and merge it once CI is green. The pre-push hook
   refuses a direct push to `main`, fast-forward or not, so this is the
   promotion mechanism, not a shortcut around it.
9. **Check production** with the read-only smoke suite, and nothing else.

Steps 4 and 7 are a person's judgement, not a command. Neither is skippable and
neither may be assumed. Say which numbered stage the work is at when reporting
on a change, and say when one finishes and the next begins.

## Never

- **Commit directly to `main` or `staging`.** Both deploy on push, so a commit
  on either is a release that has been through nothing. Enable the seatbelt
  once per clone: `git config core.hooksPath .githooks` — see
  [*Branch protection*](README.md#branch-protection) for why that is a hook and
  not a GitHub ruleset.
- **Open a pull request against `main` from anything other than `staging`.**
  `main` is what production deploys from; a pull request merged there from a
  feature branch ships to production before staging has seen the change. The
  promotion step (8, above) opens its own pull request from `staging` into
  `main` once staging is approved — that one is required, not forbidden.
- **Change the schema with hand-run SQL.** A migration file is the difference
  between a working staging and a broken production. Additive, always, with a
  `.down.sql` — without one it cannot be stepped back.
- **Point `backend/tests` or `e2e/` at production.** Both create and delete real
  records, and a run that dies partway leaves them behind. `smoke/` is the
  production suite and it writes nothing.
- **Apply a migration to production without a fresh backup.** Supabase Free
  takes no backups at all — the dump taken before promotion is the only copy
  that will ever exist. See [*Backups*](README.md#backups).

## Show SQL before running it

Anything that could change something gets shown to Matt and waits for his
approval rather than being run and reported afterwards: inserts, updates,
deletes, and DDL of any kind. That covers migrations, one-off fixes, anything
typed at `psql`, and scripts whose purpose is to execute such SQL
(`auth-setup.mjs` creating an account, `seed.mjs`).

Read-only queries need no review — run a `SELECT`, a look at
`information_schema` or a row count freely and report what it says.

The test suites are the settled exception: the fixtures in
`backend/tests/helpers.mjs` and the Playwright setup insert and delete by the
hundred, namespaced per run and cleaned up afterwards, and are covered by the
review the pull request already gets.

When in doubt, show the statement.

## Production credentials are not in this repository

The production database connection string exists only in Render and Supabase.
It is not in the checkout, not in any local `.env`, and not recoverable from a
developer machine; the backup passphrase is held by Matt personally. Do not
search for either, do not treat their absence as misconfiguration, and do not
ask for either to be pasted into a session or written into a file, a CI
variable or a script. If an operation needs one, say which operation and let
Matt run that step in the platform that already holds it.

## If production breaks

Revert the code, reverse the schema, and only then restore data — in that
order. Restoring is the only step that loses records, and it is rarely the step
that was needed. [*If production breaks anyway*](README.md#if-production-breaks-anyway)
has the commands and the honest limits.
