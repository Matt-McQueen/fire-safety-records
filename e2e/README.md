# End-to-end tests

Playwright drives the real frontend in a real browser against the real
backend and database — the same Supabase project `backend/.env` already
points at, and the same one `backend/tests/*.test.mjs` runs against. Nothing
here is stubbed or mocked: `tests/global.setup.js` creates a marker-tagged
premises and two accounts (admin, viewer) directly in the database, the way
`backend/tests/helpers.mjs` does, then signs in through the actual login form
for each and saves the session. `global-teardown.js` removes everything that
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
  saves `.auth/admin.json` / `.auth/viewer.json` (browser storage state, so
  the other specs start already signed in) and `.auth/fixtures.json` (the
  credentials and ids they need).
- `tests/login.spec.js` — unauthenticated: the login form itself, a wrong
  password, sign-in and sign-out.
- `tests/premises.spec.js` — signed in as admin: create, edit and delete a
  premises through the UI.
- `tests/role-access.spec.js` — signed in as viewer: the frontend actually
  hides admin-only navigation and actions, and 404s an admin-only route,
  rather than relying on the API alone to refuse it.
- `global-teardown.js` — deletes everything `global.setup.js` created.

`.auth/` is gitignored — it's per-run session state, not something to commit.

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
