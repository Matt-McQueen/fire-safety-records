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

## A known limitation: the full suite can still hang under this database's real capacity

This project's Supabase pooler runs in session mode with a hard 15-client
cap for the whole project - and querying `pg_stat_activity` directly shows
roughly ten of those permanently held by the project's own platform
connections (PostgREST, pg_cron, pg_net, Supavisor - the pooler itself - and
its metrics exporter), not anything this suite or the app opened. The actual
headroom for the backend process is a handful of connections, not fifteen,
so `playwright.config.js` caps `workers` at 4, sets the backend's own
`PG_POOL_MAX` to 5 for this suite specifically (render.yaml already uses the
same value in production, for the same reason), and raises both the
per-test `timeout` (60s) and the default assertion `expect.timeout` (10s)
well past Playwright's defaults, since a query here can be queued behind
others' for genuinely longer than either default allows on an otherwise
ordinary run.

Even with all of that, running the **full** suite together can still
occasionally hang for 60+ seconds on an unrelated page load or query - seen
on both `/admin/audit-log` and a plain premises picker - confirmed to be
contention from the full suite's combined load and not a bug in whichever
test happened to be running: the same test, run alone or in a small group,
passes reliably every time (checked by re-running `role-capabilities.spec.js`
alone three times in a row after it had just hung as part of a full run). If
a full run hangs or times out, it's very likely this rather than a real
regression - rerunning it, or running the affected file alone, is the way to
tell the difference. This is a real constraint of this specific shared
database's capacity relative to how much this suite has grown, not something
client-side configuration alone fully solves - narrowing it further would
need visibility this suite doesn't have into what else is using the
project's connections at the same time.

One symptom worth naming so it doesn't look like a separate problem: if this
hits the *first* test in `role-access.spec.js` (its tests share one browser
context in `test.describe.configure({ mode: "serial" })`), Playwright skips
the rest of that file as "did not run" rather than attempting them - that's
the same contention, not additional breakage, and the same rerun-alone check
applies.

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

`POST /api/auth/refresh` is limited to 60 requests per 15 minutes per address
(`backend/src/auth/authRoutes.js`), and unlike the login limit that ceiling
isn't configurable by environment variable - deliberately, since it's one of
the two endpoints reachable without a token. A single `npm test` run uses
roughly a dozen of those. Re-running the suite many times in quick succession
during development can still add up to more than 60 within the window, which
shows up as tests landing back on the login page instead of where they
expected to be. If that happens, it clears itself after 15 minutes - or
immediately by restarting the backend dev server Playwright started (its
rate-limit counters are only kept in memory), which `reuseExistingServer`
otherwise happily leaves running between runs.
