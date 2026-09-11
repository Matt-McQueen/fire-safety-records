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
- `tests/compliance-dashboard.spec.js` — signed in as admin, on a dedicated
  premises of its own: the dashboard's computed compliance checklist
  (`GET /api/premises/:id/compliance`) matches a freshly created premises'
  actual position, and recording something it was missing changes it.
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
- `tests/role-access.spec.js` — signed in as viewer: the frontend actually
  hides admin-only navigation and actions, and 404s an admin-only route,
  rather than relying on the API alone to refuse it.
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

## Why `workers` is capped

This project's Supabase pooler runs in session mode with a hard 15-client
cap for the whole project, shared by everything talking to it at once: every
Playwright worker's browser, the backend's own connection pool
(`PG_POOL_MAX=10`), and anything else hitting this database at the same time.
Past about 4 workers that contention got bad enough to occasionally produce
a stale read - `fra-lifecycle.spec.js`'s publish step, in particular, would
sometimes see zero significant findings for an assessment moments after its
own earlier request had added one. `playwright.config.js` caps `workers` at
4 for that reason; raising `PG_POOL_MAX` instead only made it worse by
hitting the pooler's own ceiling directly (`EMAXCONNSESSION: max clients
reached in session mode`).

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
