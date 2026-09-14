# End-to-end tests

Playwright drives the real frontend in a real browser against the real
backend and database — the same Supabase project `backend/.env` already
points at, and the same one `backend/tests/*.test.mjs` runs against. Nothing
here is stubbed or mocked: `tests/global.setup.js` creates a marker-tagged
premises and two accounts (admin, viewer) directly in the database, the way
`backend/tests/helpers.mjs` does. `global-teardown.js` removes everything that
setup created once the run finishes.

## Setup

Requires `backend/.env` to already exist with a working `DATABASE_URL` (see
the root [README](../README.md#setup)).

```bash
cd e2e
npm install
npx playwright install chromium
```

## Running

```bash
npm test          # headless, starts both dev servers automatically
npm run test:ui   # Playwright's UI mode, for writing/debugging tests
npm run test:headed
npm run report    # opens the HTML report from the last run
```

Set `E2E_BASE_URL` to run the same suite against a deployed frontend instead —
how a staging deployment is tested. Nothing is started locally in that case,
and `DATABASE_URL` must point at that deployment's own database, since the
fixtures below are inserted directly into it. Never point it at production:
this suite writes. `smoke/` is the read-only suite for a live environment, and
`backend/src/db/protected-database.js` refuses a database named in
`PROTECTED_DATABASE_HOSTS` before either suite reaches it.

`playwright.config.js` starts `backend` and `frontend` with `npm run dev`
itself (ports 3001 and 5173) and waits for both to answer before running
anything. If you already have them running locally, it reuses them instead
— useful while iterating, but note a server you started yourself won't have
the `NODE_ENV=test` / `SCRYPT_COST=1024` overrides the config gives its own,
which only affect the login rate limit and how fast test-account passwords
hash.

## Layout

- `tests/global.setup.js` — the "setup" project: provisions test accounts and
  writes `.auth/fixtures.json` (their credentials and ids) plus a saved
  session for the viewer account only, `.auth/viewer.json` (see the file for
  why admin doesn't get one too).
- `tests/helpers/fixtures.js` — reads those fixtures, and a `signIn(page, {
  email, password })` helper every admin-scoped test uses to log in fresh.
- `tests/login.spec.js` — unauthenticated: the login form itself, a wrong
  password, sign-in and sign-out.
- `tests/premises.spec.js` — signed in as admin: create, edit and delete a
  premises through the UI.
- `tests/fra-lifecycle.spec.js` — signed in as admin: a fire risk assessment's
  full draft → current → superseded lifecycle, including the backend's
  publish preconditions (a significant finding, recorded assessor competence)
  and that a recorded assessment can no longer have those fields edited.
- `tests/resource-engine.spec.js` — signed in as admin: create, search, filter,
  edit and delete a record through the generic list/create/edit engine that
  everything except premises, fire risk assessments, equipment and escape
  routes is served by (driven here via "people" — see resources/configs.ts).
- `tests/equipment-checks.spec.js` — signed in as admin: recording a check is
  refused without saying who did it or, for anything but a pass, what was
  found; a check history then blocks deleting the equipment outright (only
  taking it out of service is left); and the equipment's "defect outstanding"
  status tracks its most recent check, not its oldest unresolved one.
- `tests/escape-route-checks.spec.js` — the same pattern for an escape route:
  a check has to say what was found for anything but a pass, a check history
  blocks deleting the route outright, and "obstruction outstanding" tracks
  the most recent check.
- `tests/escape-route-lifecycle.spec.js` — the record's own lifecycle rather
  than its check history: its full field set saves and reads back, going out
  of and back into service both just work (there's no beforeUpdate rule on
  escape_routes, only beforeDelete), and - never given a check - it can
  actually be deleted, which escape-route-checks.spec.js's route never
  reaches.
- `tests/enforcement-notice-lifecycle.spec.js` — an alterations notice's own
  in force → withdrawn lifecycle: while in force it's one of the three
  triggers for the duty to record, independent of employee count or a
  licence (the `premises_recording_duty` view), and can't be deleted; marking
  it no longer in force needs to say why (withdrawn or complied with); once
  withdrawn the duty it was the only trigger for stops applying, and it can
  then be deleted.
- `tests/incidents-lifecycle.spec.js` — a RIDDOR-reportable incident needs
  the particulars notified to the enforcing authority recorded before it can
  be created, its RIDDOR badge tracks a report still due versus one that's
  been made, un-marking it as reportable while it still carries a report
  date or reference is refused as a contradiction, and - the one hard
  retention rule in this domain - it can't be deleted inside RIDDOR 2013 reg
  12's three-year mark regardless of role, admin included; contrasted with an
  ordinary, non-reportable incident, which carries no such restriction.
- `tests/fire-drills-lifecycle.spec.js` — a drill that found no issues is a
  clean record, but one that found issues and doesn't say what was done
  about them is refused (reg 14(1): a drill is how the procedures actually
  working is tested, and a record of a problem with nothing done about it
  isn't evidence of that); also covers fire_drills' place in the compliance
  checklist as a live check - "missing" with none recorded, "ok" once one is.
- `tests/training-records-lifecycle.spec.js` — reg 20(4) requires training to
  happen during working hours, so a record saying it didn't has to explain
  why rather than leave that as a bare flag; a next_due_on before the
  delivery date is refused as incoherent regardless; and covers training's
  place in the compliance checklist through all three statuses - "missing"
  with none recorded, "ok" once one is, "attention" once one is actually
  overdue - agreeing with that record's own "Overdue" badge on the list.
- `tests/enforcement-visit-lifecycle.spec.js` — the simplest record in this
  domain: no status machine, no compliance tie-in, and exactly one rule (a
  visit can't be dated in the future). What's actually worth pinning down is
  the role boundary: creating one needs manager specifically, one rank above
  what an assessor can reach - unlike a fire risk assessment draft or a piece
  of equipment, which an assessor can create outright. Also caught a real
  bug: editing one and revisiting its own edit page showed the pre-edit
  values back, the generic engine's version of the gap `PremisesFormPage.tsx`
  had for its own page - see the fix below.
- `tests/compliance-dashboard.spec.js` — signed in as admin, on a dedicated
  premises of its own: the dashboard's computed compliance checklist
  (`GET /api/premises/:id/compliance`) matches a freshly created premises'
  actual position, and recording something it was missing changes it.
- `tests/compliance-checklist-detail.spec.js` — the same checklist through
  the Compliance tab on the premises page instead of the dashboard: it isn't
  fetched until that tab is actually opened, and covers the one status the
  dashboard test doesn't - "attention" - by way of an equipment check whose
  next_due_on has already passed.
- `tests/user-admin.spec.js` — signed in as admin: creating a user grants the
  premises checked on the form, changing its role and deactivating it are
  reflected in the list, deactivation actually blocks it from signing in
  again, an admin can't demote/deactivate their own account, and the audit
  trail records all three account changes.
- `tests/audit-log.spec.js` — the audit log's Outcome filter actually finds
  the other two outcomes besides success: a wrong password ("failure"), and
  a manager refused for trying to mark a check schedule statutory - a 403
  raised well past the endpoint's own role gate, which the generic error
  handler audits the same as any other ("denied").
- `tests/account-page.spec.js` — a throwaway account of its own changes its
  own password: a wrong current password and an unchanged new one are both
  refused, and a real change signs out old sessions - the old password stops
  working and the new one signs in.
- `tests/role-capabilities.spec.js` — the two roles in between viewer and
  admin: an assessor may create and amend records but not delete or publish
  them, and a manager may also do those - except deleting a premises
  outright, which needs admin specifically, unlike equipment or a draft
  assessment.
- `tests/role-access.spec.js` — signed in as viewer: the frontend actually
  hides admin-only navigation and actions, and 404s an admin-only route,
  rather than relying on the API alone to refuse it.
- `tests/dark-mode.spec.js` — defaults to the system's colour scheme when
  nothing is stored yet, and a toggled choice persists across a reload and
  overrides system preference from the very first paint - not just once
  React has mounted - covering index.html's pre-React inline script as well
  as lib/ThemeContext.tsx. Doesn't sign in for the first check: theme applies
  outside auth entirely.
- `tests/mobile-nav.spec.js` — below Tailwind's lg breakpoint, AppShell swaps
  the always-visible sidebar for a hamburger-triggered slide-out panel;
  opening it, navigating from it, and dismissing it via the backdrop all
  work, and above the breakpoint there's a static sidebar and no hamburger.
- `global-teardown.js` — deletes everything `global.setup.js` created.

`.auth/` is gitignored — it's per-run session state, not something to commit.

## Why admin has no saved session, but viewer does

A saved session's refresh cookie is single-use: the backend rotates it on
every refresh and treats a second presentation as theft, which revokes the
whole session (`backend/src/auth/authService.js`'s `refresh()`). That's fine
when exactly one test file ever restores a given saved session — role-access.spec.js
is the only file that loads `viewer.json`, in one shared browser context. It
broke the moment a *second* admin-scoped file (`fra-lifecycle.spec.js`) was
added alongside `premises.spec.js`: both loaded `admin.json` into their own
separate context, raced to consume the same cookie, and the loser's session
was revoked mid-test. Rather than re-litigate that every time a new
admin-scoped test file is added, every one of them logs in fresh via
`signIn()` instead — one extra request, and no ceiling on how many test files
can use that role.

## History: a "database capacity" problem that turned out not to be one

For a long time, a full run of this suite would reliably fail a large chunk
of its files at once - roughly a third of them, always the same ones, always
at the same generic step (the first UI action after signing in) - while the
same files passed every time run alone or in a small group. That signature
was originally diagnosed as this project's Supabase database running out of
real connection headroom under the suite's combined load: Supabase's pooler
ran in session mode with a hard 15-client cap for the whole project, and
`pg_stat_activity` really did show roughly ten of those permanently held by
the project's own platform connections (PostgREST, pg_cron, pg_net, Supavisor
itself, its metrics exporter), leaving only a handful for everything else.
`playwright.config.js` was tuned around that theory for some time: `workers`
capped at 4, the backend's own `PG_POOL_MAX` lowered to 5 to match, and both
`timeout` and `expect.timeout` raised well past Playwright's defaults.

None of that was wrong exactly - that connection cap is real, and worth
knowing about if this ever moves database providers again - but it was not
the cause of this particular failure. The project was migrated to Neon
specifically to test that diagnosis (Neon's pooler runs in transaction mode
with no such session cap) and the *identical* set of files still failed,
reproduced three times in a row including with Neon's compute already warm.
Serving the frontend as a production build instead of Vite's dev server, and
fixing a real (separate) N+1 query problem in the compliance dashboard, each
independently changed nothing either. What finally explained it: the access
token lives only in memory, never `localStorage`, so every full page
navigation (`page.goto`, not a client-side route change) has nothing to check
a session with except calling `POST /api/auth/refresh` - `AuthContext.tsx`
does this once on every mount. `tryRefresh()` treats any non-2xx response,
429 included, as "not signed in" and drops back to the login page
(`frontend/src/lib/http.ts`). That endpoint was rate limited to 60 requests
per 15 minutes per address, hardcoded rather than configurable
(`backend/src/auth/authRoutes.js`) - and this suite's `page.goto` calls alone
add up to well over 60 across a full run, all from the one address every
`npm test` run uses. Once the count crossed 60 partway through a run, every
navigation after that point got a 429 and landed back on the login screen
instead of wherever the test expected to be - consistently the same files,
because a full run's total navigation count and rough ordering barely change
run to run.

The fix was to make that limit configurable the same way `RATE_LIMIT_LOGIN`
already was (`RATE_LIMIT_REFRESH`, `backend/src/config/env.js`, default
unchanged at 60) and raise it for this suite in `playwright.config.js`,
exactly as `RATE_LIMIT_LOGIN` already was. With that alone, a full run at
Playwright's actual default worker count (one per CPU core, no `workers`
override) and default timeouts passed all 30 tests in under 40 seconds,
repeated twice. `workers`, `timeout` and `expect.timeout` were all removed
from this config as a result - none of them were doing anything for this
problem, and nothing here needs them anymore. `PG_POOL_MAX: 5` stays in the
backend's env below, because that connection cap is still real even though
it was never what broke this suite.

The lesson worth keeping: a failure signature that looks exactly like
resource contention - same files, same step, passes alone, gets worse as the
suite grows - is not proof of *which* resource. Two different database
providers and two different frontend serving strategies were tried and ruled
out before the actual constant, non-database, non-frontend ceiling (a fixed
requests-per-window count, shared by every navigation regardless of what
else changes) was found by reading what the failing page actually showed
(the login form, not a slow list) rather than continuing to tune
concurrency.

One symptom that's just this same mechanism wearing a different name: if it
hits the *first* test in `role-access.spec.js` (its tests share one browser
context in `test.describe.configure({ mode: "serial" })`), Playwright skips
the rest of that file as "did not run" rather than attempting them.

## A couple hundred stale accounts already in this database

While tracking the above down, `user-admin.spec.js` turned up close to 200
accounts named `apitest-<hex>-...@example.test` already sitting in this
database - the naming convention `backend/tests/helpers.mjs` uses, from a
backend integration test run that was evidently interrupted before its own
cleanup ran. They're harmless to this suite (every lookup here goes through
the search box rather than assuming a user is on the unfiltered list's first
page), but worth knowing about and cleaning up directly in the database if
they're not wanted - this suite has no reason to touch accounts it didn't
create.

## A rate limit you may notice

`POST /api/auth/refresh` is limited to `RATE_LIMIT_REFRESH` requests per 15
minutes per address (`backend/src/auth/authRoutes.js`), 60 by default in
production and raised well past that for this suite (see the history section
above for why - every full page navigation calls it once, and this suite
does a lot of those). Running against a backend that isn't using this
config's env - one started by hand without it, or left over from before this
was fixed - can still hit the production default and show tests landing back
on the login page instead of where they expected to be. If that happens, it
clears itself after 15 minutes, or immediately by restarting the backend
dev server with this config's env in effect (rate-limit counters are only
kept in memory).
