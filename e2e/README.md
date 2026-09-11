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
