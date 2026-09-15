# Fire Safety Records

A database of workplace fire safety records for premises in **Scotland**,
with an Express backend (`backend/`) and a React (Vite) frontend
(`frontend/`). The database lives in Supabase.

The schema is in [`backend/src/db/schema.sql`](backend/src/db/schema.sql)
and the API in [`backend/src/`](backend/src). The web UI lives in
[`frontend/src/`](frontend/src) — React 19, TypeScript and Tailwind CSS 4,
built on Vite.

**All access to the database goes through the API, and all of the business
rules live there.** Nothing that reads or writes these records talks to
Postgres directly, and no client is trusted to decide whether a record is
allowed. A UI that skipped a rule would simply be refused.

## Legislative basis

Scotland has its own fire safety regime, separate from England and Wales:

- **Fire (Scotland) Act 2005**, Part 3 Chapter 1 — s.53 employer duties,
  s.54 persons with control, s.61 enforcing authorities, s.62 powers to
  require and inspect records, sch.2 the fire safety measures
- **Fire Safety (Scotland) Regulations 2006** (SSI 2006/456) — the duties
  to *record*, at regs 8, 9 and 10(2)
- **Health and Safety at Work etc. Act 1974** s.2(3) — written policy
- **DSEAR 2002** — dangerous substances
- **RIDDOR 2013** reg 12 — reportable incidents

The Regulatory Reform (Fire Safety) Order 2005, Fire Safety Act 2021 and
Fire Safety (England) Regulations 2022 do **not** extend to Scotland and
are deliberately not modelled.

The enforcing authority for a workplace is the Scottish Fire and Rescue
Service (HSE for construction sites and ships under construction/repair).

## Two things worth knowing before extending the schema

**Recording duties are conditional, but the underlying duties are not.**
Every employer must carry out a fire risk assessment. Only some must
*record* it: where 5 or more employees are employed, or the premises need
a licence or registration, or an alterations notice is in force. The
`premises_recording_duty` view computes which of those three triggers
applies to each premises.

**No test or drill frequency is set by legislation.** Every interval in
common use comes from Scottish Government guidance or a British Standard
(BS 5839-1 alarms, BS 5266-1 emergency lighting, BS 5306-3
extinguishers). Intervals therefore live in the `check_schedules` table
as configurable data with a `recommended_by` provenance column — they are
not hard-coded, and `is_statutory` should stay false. The only retention
period actually in legislation is RIDDOR's three years for reportable
incidents, encoded as the generated `incidents.retain_until` column.

Table and column comments in `schema.sql` cite the specific provision
each record answers to. The `legal_basis` table catalogues those duties
and flags which carry an express duty to record.

## Data protection

The database holds personal data, and `fra_persons_at_risk` can hold
special category data under UK GDPR Art.9 where someone is recorded as at
risk by reason of disability. Row level security is enabled on every
table with no policies, which denies all access through Supabase's Data
API; the backend connects directly over Postgres as the table owner and
is unaffected.

## Setup

Prerequisites: Node.js 20+ and a Supabase project.

1. In the Supabase SQL Editor, run `backend/src/db/schema.sql`.
2. Copy the connection string from Project Settings -> Database ->
   Connection string (URI). Use the **session pooler** unless you are on
   an IPv6 network — direct connections are IPv6-only without the paid
   IPv4 add-on.

```bash
cd backend
cp .env.example .env   # paste the connection string into DATABASE_URL
npm install
npm run auth:init      # creates users, user_premises, refresh_tokens, audit_log
npm run auth:user -- --email you@example.com --role admin --premises all
npm run dev
```

`auth:user` prints a generated password once. Store it before closing the
terminal; it is never recoverable, only resettable — see Accounts below.

Set `JWT_SECRET` in `.env` before deploying. Outside production a random
key is generated at startup, which means every restart signs everyone out.

`DATABASE_URL` also works against any other Postgres instance — the pool
only enables SSL when the host isn't `localhost`/`127.0.0.1`.

### Accounts

The admin account created during setup:

| | |
|---|---|
| Email | `matt@reid-timoney.com` |
| Role | `admin` — every premises, and user administration |
| Password | generated at setup and shown once; not recoverable |

**Issuing a new password.** Passwords are stored only as scrypt hashes, so a
forgotten one is reset rather than looked up:

```bash
cd backend
npm run auth:user -- --email matt@reid-timoney.com --reset
```

That prints a new password once, and leaves the role, the display name and
the premises grants exactly as they were. It also signs out every existing
session for that account, so a session opened with the old password cannot
outlive the reset.

Pass `--password` instead of `--reset` to choose the password yourself; it
must be at least 12 characters and is checked against the account's own
email and name.

**Other account management.** Once signed in as an admin, accounts are
managed through the API — `GET /api/users`, `POST /api/users`,
`PATCH /api/users/:id` to change a role or the premises granted, and
`DELETE /api/users/:id` to deactivate. The API will not let the last active
admin be demoted, deactivated or deleted, because nothing in it could undo
that. `POST /api/auth/change-password` is how a signed-in user changes
their own.

The same script creates other accounts:

```bash
npm run auth:user -- --email warden@example.com --role assessor --premises 1,2
```

An account with no premises granted can read nothing, which is the
intended default for a new one.

## Sample data

```bash
cd backend
npm run seed         # clear the sample data, then insert it
npm run seed:clear    # clear the sample data only
```

Both run in a single transaction and are safe to repeat. Clearing is
scoped by name to the five fictional premises and eight fictional people
the sample defines, so real records are never touched — run
`npm run seed:clear` before going live.

The data is deliberately shaped to exercise the awkward cases: five
premises covering every state of `premises_recording_duty` (each of the
three triggers in isolation, plus one where the duty does not apply); an
assessment superseded by its review; a premises assessed but with
`recorded_on` NULL, because only the duty to *record* is conditional;
outstanding and completed measures; overdue checks and training; an
unresolved equipment failure; and a RIDDOR-reportable dangerous
occurrence alongside non-reportable incidents.

The SQL files can also be pasted straight into the Supabase SQL Editor if
you would rather not run the script.

## The API

Every table in the schema is served at `/api/<resource>` with the same
five operations, the same access control and the same audit trail:

| Request | Does |
|---|---|
| `GET /api/<resource>` | list, with filtering, search, sorting and pagination |
| `GET /api/<resource>/:id` | one record |
| `POST /api/<resource>` | create |
| `PATCH /api/<resource>/:id` | amend named fields |
| `DELETE /api/<resource>/:id` | delete, where the rules allow it |

`GET /api/` returns a machine-readable index of every resource, the roles
each operation needs, and the filters and sort keys it accepts.

Beyond plain CRUD:

- `GET /api/premises/:id/compliance` — the computed compliance position
- `GET /api/fire-risk-assessments/:id/full` — an assessment with its
  findings, measures and persons at particular risk
- `POST /api/fire-risk-assessments/:id/publish` — make a draft the
  recorded assessment
- `GET /api/users/audit/log` — the audit trail (admin)

Lists return `{ data, page: { limit, offset, total } }` and single records
`{ data }`. Errors return `{ error: { code, message, requestId, details } }`.
An unrecognised body field or query parameter is a 400 rather than
something quietly ignored, so a client typo cannot silently widen a result
or drop a value.

### Authentication

`POST /api/auth/login` returns a short-lived access token, which the
client keeps in memory and sends as `Authorization: Bearer <token>`, and
sets a refresh token in an httpOnly, SameSite=Strict cookie scoped to
`/api/auth`. `POST /api/auth/refresh` exchanges it for a new pair,
rotating the old one out.

Every endpoint except `/api/health`, `/api/auth/login` and
`/api/auth/refresh` requires a token. Authentication is applied once, in
front of the whole router, so an endpoint cannot be left open by being
forgotten.

The security decisions worth knowing:

- Passwords are hashed with scrypt from `node:crypto` — memory-hard, and
  no native module to keep patched. The cost is configurable, and old
  hashes are upgraded silently at the owner's next sign-in.
- Refresh tokens are stored only as SHA-256 hashes and rotated on every
  use. Presenting a spent one is treated as theft: the whole chain from
  that login is revoked and both parties must sign in again.
- The access token identifies the account and nothing more. The role and
  the premises it may reach are read from the database on every request,
  so a demotion, a deactivation or a withdrawn grant takes effect at once
  rather than whenever the token happens to expire.
- Changing a password signs the account out everywhere.
- Repeated failed sign-ins lock the account. Sign-in attempts are rate
  limited per address, and the rest of the API per account.
- A wrong password, an unknown email and a deactivated account all give
  the same answer. Which it was is in the audit trail.

### Roles and premises

| Role | May |
|---|---|
| `viewer` | read the records for its premises |
| `assessor` | also create and amend them |
| `manager` | also delete them, manage premises, people and appointments, and publish assessments |
| `admin` | everything, including user administration, and every premises |

Non-admin accounts reach only the premises listed for them in
`user_premises`. An account with none can read nothing, which is the safe
default for a new one. A record the caller has no access to answers 404
rather than 403, because a 403 would confirm it exists.

The boundary holds for records reached through a parent too — a measure is
three joins away from its premises, and is scoped just the same.

`people` is the exception. Staff move between sites and an external
assessor may work across several, so a person is not owned by one
premises: a manager or admin sees the whole directory, and a viewer or
assessor sees only the people connected to a premises they cover. The
sensitive per-premises data — who is at particular risk, and why — is in
`fra_persons_at_risk`, which is scoped normally.

### The business rules

The rules are in `backend/src/domain/`, next to the resource each belongs
to, and each cites the provision it answers to. A selection:

- **The assessment lifecycle.** Draft, then current, then superseded. A
  draft is working material. Publishing it makes it the record and freezes
  what reg 9 requires to be recorded; publishing a successor supersedes
  the previous one automatically, so a premises has exactly one current
  assessment. A superseded assessment never changes again.
- **Publishing is conditional on the duty to record.** Where the duty
  applies, the assessment must record at least one significant finding
  (reg 9(1)(a)) and what the assessor's competence rests on. Where the
  premises holds dangerous substances the assessment must cover them
  (regs 6-7, and DSEAR). Where it identifies a young person as especially
  at risk it must say so.
- **Records that evidence a duty are not deleted.** A recorded assessment,
  a completed check and a superseded version are kept. Equipment with a
  check history is taken out of service instead. A person who appears in
  the records has `ended_on` set instead. A notice in force is withdrawn
  rather than removed.
- **RIDDOR's three years.** A reportable incident cannot be deleted before
  `retain_until` by anyone, an admin included.
- **Intervals are configuration, not code.** A check's next due date is
  computed from `check_schedules`; where no schedule covers it, no date is
  invented. Marking a schedule statutory takes an admin and a citation,
  because no interval here is fixed by legislation.
- **Records have to be coherent.** A failed check must say what was found
  and a passed one must not; a measure recorded as taken must have a
  completion date, and a planned one a target; a drill that found problems
  must record what was done about them; and nothing that has happened may
  be dated in the future.

`GET /api/premises/:id/compliance` puts the same rules to work reading
rather than writing: what is recorded, what is overdue and what is missing
for one premises, each with the provision it answers to. It reports
whether the *records* are present and current, which is not the same as
compliance — the response says so.

### Audit

Every create, update and delete, every authentication event and every
refused request is written to `audit_log`, with who did it, which premises
it concerned, the fields that changed, and the request id echoed back in
the response. Passwords, tokens and hashes are redacted before anything is
written. Nothing in the API writes to the trail directly, and nothing
deletes from it.

## Frontend

React 19, TypeScript and Tailwind CSS 4, built with Vite and React Router.
There is no local component state pretending to be authorisation: every
screen calls the API above and shows whatever it answers, access token
included only in memory and never in `localStorage`.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173, proxying /api to the backend on :3001
npm run build    # type-checks (tsc -b) then produces frontend/dist
```

Structure, in `frontend/src/`:

- `lib/` — the API client (`http.ts` handles the access-token refresh-and-retry
  cycle transparently), auth and premises React contexts, and the query client.
- `resources/` — a declarative field/column/filter config per resource, close
  enough to the matching `backend/src/domain/resources/*.js` definition that
  the two should be read side by side when either changes. This drives the
  generic list and create/edit pages.
- `components/resource/` — the generic engine: a table, a field-driven form,
  and a nested child-record form (a finding under an assessment, a check
  under a piece of equipment).
- `pages/` — bespoke pages for premises (with the compliance checklist),
  fire risk assessments (the full draft → publish → current → superseded
  lifecycle, with findings, measures and persons at risk managed inline),
  equipment and escape routes (each with their check history), and user
  administration; every other resource is served by the generic engine under
  `pages/resource/`.

The one hard-coded assumption worth knowing: **the frontend does not
duplicate a single business rule.** Required-looking fields are marked from
the zod schemas for a decent form, but what actually decides whether a
record is accepted is always the API's answer — a 422 `rule_violation` is
rendered from `error.details.fields` and `error.message` rather than
pre-empted client-side. That is deliberate, not an oversight: see the
disclaimer at the top of this file.

Deployment is Cloudflare Pages, per [`render.yaml`](render.yaml)'s
neighbour — `frontend/functions/api/[[path]].js` proxies `/api/*` to the
Render backend so the refresh cookie stays first-party (see the comment in
that file for why). Set the Pages project's `API_ORIGIN` env var to the
Render service URL, and the backend's `CORS_ORIGINS` to the Pages URL.

## Staging

A second, fully separate environment for trying out changes before they
reach production — its own database, its own API, its own frontend URL —
all tracking the `staging` branch instead of `main`.

| | Production | Staging |
|---|---|---|
| Database | Supabase | [Neon](https://neon.tech) (`fire-safety-records-staging` project) |
| API | Render (`render.yaml`) | [Vercel](https://vercel.com) (`backend/vercel.json` + `backend/api/index.js`) |
| Frontend | Cloudflare Pages, `main` branch | Cloudflare Pages, `staging` branch — `staging.fire-safety-records.pages.dev` |

The API runs on Vercel rather than a second Render service because Render
now requires a card on file even for its free plan; Vercel's free Hobby tier
does not. `backend/api/index.js` wraps `createApp()` (already separate from
the listener in `src/index.js`) as a Vercel serverless function, and
`backend/vercel.json` rewrites every path to it so the app's own `/api`
router sees the real incoming URL. The Vercel project's Framework Preset
must be **Other**, not the auto-detected **Express** — that preset applies
its own zero-config entry-point discovery that finds `src/app.js` instead of
`api/index.js`, and `app.js` has no default export, so every request 500s.

**Name the deployment.** Set `APP_ENVIRONMENT=staging` in the Vercel project's
Settings -> Environment Variables (for its Production environment - that
project's production branch is `staging`), and `APP_ENVIRONMENT=production` on
the Render service. It has to be the dashboard: current `vercel.json` has no
property that defines environment variables, and `render.yaml` only reaches a
service that is synced from the blueprint. Without it the API reports its
environment as `unnamed` and the smoke suite refuses to confirm which
environment answered - which is the point, since the alternative was staging
quietly calling itself production.

To reach the Vercel deployment, the Cloudflare Pages **Preview** environment
(Settings → Variables and secrets, with the environment switched to
*Preview*) has its own `API_ORIGIN` pointing at the Vercel URL, kept
separate from the Production environment's `API_ORIGIN` (which still points
at Render). The `staging` branch gets a stable alias —
`staging.<project>.pages.dev` — rather than the usual per-commit preview
URL, because Cloudflare Pages aliases every branch deployment that way.

**Promoting a change**: pushing a branch is all it takes — Render, Vercel and
Cloudflare Pages each deploy from the branch they track. Which branch a change
reaches when, and what has to be true before it reaches the next one, is the
subject of *Making a change* below. The staging database is seeded with the
same sample data as local development (`npm run seed`) and is safe to reset the
same way — it holds no real records.

## Making a change

Every change takes the same route, and the route exists for one reason:
production is never where a change is first tried. Two of the steps are a
person's judgement rather than a command, and neither is skippable.

1. **Branch off `staging`.** Nothing is committed to `main` or `staging`
   directly.
2. **Make the change.** A schema change is a migration file
   (`backend/src/db/migrations/`), not SQL run by hand — see that directory's
   README for why that distinction is the difference between a working staging
   and a broken production.
3. **Prove it locally**: `backend` `npm test`, `frontend` `npm run lint`,
   `npm test` and `npm run build`, then `e2e` `npm test`, then Fallow over the
   diff. All of it before the pull request, not after: a deployed environment
   is a poor place to discover that something does not compile.
4. **Open the pull request against `staging`**, with those results in the
   description. CI runs the same checks on a throwaway database, and the pull
   request waits for review. **Not against `main`** — `main` is what production
   deploys from, so a pull request merged there is a change shipped to
   production before staging has seen it.
5. **Merge to `staging`.** Apply any migration to the staging database first
   (`npm run migrate`), then let the push deploy. Wait for the deploy to land
   before testing it:

   ```bash
   cd smoke
   node wait-for-deploy.mjs --url https://staging.fire-safety-records.pages.dev --commit $(git rev-parse HEAD)
   ```

6. **Run the suites against staging**, which is the first run against a real
   deployment rather than a working copy:

   ```bash
   cd backend && API_BASE_URL=https://<vercel-url> DATABASE_URL=<neon-url> npm run test:integration
   cd e2e     && E2E_BASE_URL=https://staging.fire-safety-records.pages.dev DATABASE_URL=<neon-url> npm test
   ```

7. **Hand it over.** Staging is where the change is looked at by a person, not
   where it is debugged.
8. **Promote, once that person has approved it.** Take a backup first —
   `cd backend && npm run backup` — *before* applying any migration to
   production. Reverting a deploy reverts the code and does not reverse a
   migration, and the runner will refuse a destructive one without a backup
   recorded in the last 24 hours. Set any new environment variable
   in Render, Vercel and the Pages project before the deploy lands, not after.
   Then fast-forward `main` from `staging` and push.
9. **Check production** with the read-only suite, and nothing else:

   ```bash
   cd smoke
   SMOKE_WEB_URL=https://fire-safety-records.pages.dev SMOKE_ENVIRONMENT=production \
   SMOKE_COMMIT=$(git rev-parse HEAD) npm test
   ```

   The `Smoke` workflow does steps 5 and 9 automatically on every push to
   `staging` and `main`; run it by hand from the Actions tab against either
   environment.

   A promotion that changes nothing under `backend/` will not produce a new
   Render build — `render.yaml` sets `rootDir: backend` — so the API stays on
   the last commit that did, and is right to. The gate knows that and says so
   in its output; see [*Why the API is allowed to be
   behind*](smoke/README.md#why-the-api-is-allowed-to-be-behind) for where it
   draws the line between that and a deploy that failed.

**Never point `backend/tests` or `e2e/` at production.** Both create premises,
people and accounts directly in the database and delete them afterwards, which
is the right trade for a disposable environment and the wrong one for a live
database holding personal data. `smoke/` is the production suite and it writes
nothing.

### If production breaks anyway

Three things can be wrong, and they come back in this order. Do not skip to the
last one: restoring a backup is the only step that loses data, and it is rarely
the step that was needed.

**1. The code.** Revert the merge on `main` and push; Render and Pages redeploy
from it. Confirm what is actually live rather than assuming:

```bash
cd smoke
node wait-for-deploy.mjs --url https://fire-safety-records.pages.dev --commit $(git rev-parse HEAD)
SMOKE_WEB_URL=https://fire-safety-records.pages.dev SMOKE_ENVIRONMENT=production npm test
```

If the release contained no migration, that is the whole recovery and nothing
has been lost.

**2. The schema**, if the release did contain one. `npm run migrate:down`
reverses the most recently applied migration using its `.down.sql`. Reversing
an additive migration loses nothing that existed before it — dropping a column
that migration added destroys only data that did not exist an hour ago — which
is the entire reason migrations are required to be additive. A migration
without a `.down.sql` cannot be stepped back, which is why writing one is a
rule rather than a courtesy.

**3. The data**, if something has actually destroyed it — a bad backfill, a
wrong `UPDATE`, a column that went. This is where a backup comes in, and where
the honest limits are:

```bash
cd backend
npm run restore:check    # rehearse into a scratch database first, always
```

Restoring the production database from a dump taken before the promotion
**loses every record written since that dump**. If the deploy was at 09:00 and
the damage was noticed at 09:40, a restore returns the database to 09:00 and
those forty minutes of real records are gone — and `audit_log` lives in the
same database, so it goes too and cannot be used to reconstruct them. There is
no configuration of this setup that avoids that trade: Supabase's Free plan
takes no backups at all, and point-in-time recovery is a paid add-on on top of
a paid plan. What exists here is the dump you took before the promotion, and
the discipline that means you rarely need it.

So the order matters. Revert the code, reverse the schema, and only restore
data when something is genuinely gone.

### Backups

Supabase Free takes **no** backups — not daily, not point-in-time. The dumps
this repository takes are the only copies that will ever exist.

```bash
cd backend
npm run backup           # dump, verify, encrypt, record a manifest
npm run restore:check    # restore the newest one into a scratch database
```

| | |
|---|---|
| `BACKUP_DATABASE_URL` | Which database to back up. Prefer it over letting the command fall through to `DATABASE_URL`, which is whatever the checkout points at — for a developer, their own. A local target is refused outright unless `--allow-local` says it was meant. |
| `BACKUP_DIR` | Required, no default. Somewhere you control and back up, **outside the checkout** — this repository is public. |
| `BACKUP_PASSPHRASE` | Encrypts the dump (AES-256-GCM). Lose it and the backup is gone; put it in your password manager first. |
| `BACKUP_KEEP` | How many dumps to keep per database. Default 10. |
| `RESTORE_URL` | For `restore:check`: an empty, throwaway database. It refuses a protected host. |

`backup.mjs` needs the PostgreSQL client tools (`pg_dump`, `pg_restore`) on
PATH, at a major version at or above the server's — they do not come with Node:

```powershell
winget install PostgreSQL.PostgreSQL.17 --interactive
```

Install the server alongside the tools rather than the tools alone. `restore:check`
has to restore the dump into something, and without a local server a rehearsal
has nowhere to go. `--interactive` is what lets you choose the superuser
password, which you need for `RESTORE_URL`. The script checks the version before it starts
and says what to install if it cannot.

Three things it does that a bare `pg_dump` does not. It lists the dump back with
`pg_restore --list` and refuses to call an empty file a backup. It writes a
manifest beside each dump — when, from which host, how many objects, the
SHA-256, **and which migrations that database had applied** — which is what
`npm run migrate` reads when it wants proof that a recent backup of *this*
database exists before it will apply a destructive migration, and what tells a
restorer a year from now which schema is actually in the file. And it refuses a
local database unless told explicitly, because the failure it is guarding
against is not a crash: it is a perfectly valid backup of the wrong database,
reported as success, leaving someone believing production is covered.

**Rehearse it.** A dump nobody has restored is a file with a hopeful name.
`npm run restore:check` puts the newest one into a scratch database and checks
that every table in `schema.sql` came back, that the reference tables are not
empty, and which migrations the dump predates. CI rehearses the same cycle on
every pull request against its own throwaway database, so the scripts
themselves cannot rot — but that proves the code, not your backups. Run it
against a real dump from time to time.

### What staging cannot tell you

Staging is a separate environment, not a copy of production, and the
differences are load-bearing:

- **The API runs differently.** Production is one long-lived Node process on
  Render; staging is Vercel serverless functions. Rate limits are held in
  memory, so on staging they reset with every cold start and are effectively
  per-instance. Anything depending on process lifetime — a cache, a timer,
  pooled connections — behaves differently there.
- **The database is a different product.** Neon on staging, Supabase on
  production, with different connection limits and pooler behaviour.
- **The data is sample data.** Volume-dependent problems do not appear.

So a pass on staging is evidence, not proof, for those classes of change, and
the smoke suite on production is what actually closes the loop.

### Branch protection

Everything above is convention until something enforces it: `main` and
`staging` both deploy on push, so one push to either is a release that has been
through nothing.

**GitHub will not enforce it on this repository as it stands.** Branch
protection and rulesets are both refused on a private repository on the Free
plan — `403: Upgrade to GitHub Pro or make this repository public`. Two ways to
get the real thing, and one that is not enforcement but catches the mistake:

1. **Make the repository public.** Rulesets are then free. Nothing here is a
   secret — `.env` has never been committed and the connection strings live in
   the platforms' own dashboards — but it holds a real database's schema and is
   yours to publish or not.
2. **GitHub Pro.** The lock, at a monthly cost.
3. **Neither, for now**: [`.githooks/pre-push`](.githooks/pre-push) refuses a
   direct push to `main` or `staging` from this machine. Client-side, so it is
   a seatbelt rather than a lock — but the one person who can push is the one
   person it stops. Enable it once per clone:

   ```bash
   git config core.hooksPath .githooks
   ```

Once the repository is public or on Pro, one ruleset covers both branches:

```bash
gh api -X POST repos/:owner/:repo/rulesets --input .github/branch-ruleset.json
```

It requires a pull request and all three CI checks on both branches, forbids
force pushes and deletion, and has no bypass actors — so it applies to the
owner too, which is the point. `required_approving_review_count` is **0**, not
1: GitHub does not let anyone approve their own pull request, so on a
single-maintainer repository a count of 1 makes every branch unmergeable. The
pull request and the green checks are still required; what is left out is a
gate one person cannot pass. Raise it to 1 the moment there is a second person.

### The smoke environments

The `Smoke` workflow reads each environment's URLs and credentials from the
GitHub Environment named for it (Settings → Environments). Both are configured:

| | `staging` | `Production` |
|---|---|---|
| `SMOKE_WEB_URL` | `https://staging.fire-safety-records.pages.dev` | `https://fire-safety-records.pages.dev` |
| `SMOKE_API_URL` | `https://fire-safety-records-api-staging.vercel.app` | `https://fire-safety-records-api.onrender.com` |

Note the capital P: `Production` already existed, created by the Vercel
integration. Workflows match environment names case-insensitively, so
`environment: production` in `smoke.yml` resolves to it.

The `SMOKE_EMAIL` and `SMOKE_PASSWORD` **secrets** are set for `Production`
and not yet for `staging`. Without them the smoke suite skips its signed-in
half — the endpoint index, the premises list, the compliance summary, the
refused audit log and the refresh cookie's flags — and checks only what an
anonymous caller can see.

The account they name is a viewer with no premises granted, which can read
nothing at all: the least valuable credential that still proves sign-in works.
To create the staging one, with the Neon URI in the environment so it lands in
the staging database rather than production's:

```powershell
cd C:\Database-API-Demo\backend
$env:DATABASE_URL = "<the Neon connection string>"
$pw = node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
node scripts/auth-setup.mjs --email smoke@example.com --name "Smoke check" --role viewer --password $pw
gh secret set SMOKE_EMAIL --env staging --body "smoke@example.com"
gh secret set SMOKE_PASSWORD --env staging --body $pw
Remove-Item Env:\DATABASE_URL
```

Two things about that sequence are deliberate. It calls
`scripts/auth-setup.mjs` directly rather than through `npm run auth:user`:
**npm echoes the command it is about to run**, so a password passed as
`--password` through npm ends up in the scrollback, in CI logs, and in
anything else reading that output — which is exactly what the flag is there to
avoid. And it passes `$pw` as a variable rather than a literal, so PowerShell's
history file records the variable name and not its value.

Omitting `--password` instead generates a strong one and prints it once, which
is the right choice for an account a person will use; for one that only a
machine ever signs in as, generating it into a variable means nobody ever has
to see or store it.

To check a smoke account works before trusting it in CI, run the suite by hand
with the same credentials — it writes nothing:

```powershell
cd C:\Database-API-Demo\smoke
$env:SMOKE_WEB_URL = "https://staging.fire-safety-records.pages.dev"
$env:SMOKE_EMAIL = "smoke@example.com"; $env:SMOKE_PASSWORD = $pw
npm test
```

## Tests

```bash
cd backend
npm test
```

That runs two suites. `npm run test:integration` drives the authentication
flows, the role and premises boundaries, input handling, and each of the
business rules above through the real API and a real database, because
premises scoping, transactional rules, generated columns and foreign keys
are not things a stubbed pool would exercise — everything a run creates is
namespaced and removed afterwards, so a run leaves the database as it found
it. `npm run test:unit` (`backend/tests/unit/`) covers the same layer's
pure logic in isolation — date rules, request validation, password hashing
and policy, JWT signing and verification, the premises-access checks, the
Postgres-error-to-response mapping and the audit trail's redaction — with
no database and no network, so it runs in well under a second and is what
to reach for while changing that logic.

```bash
cd frontend
npm test
```

Vitest and React Testing Library, covering the parts of the frontend that
do not need a browser attached to a running API: the HTTP client's
token-refresh-and-retry behaviour, the session store, the auth service, the
role-ranking helper that mirrors the backend's, the resource configs that
drive the generic list/create/edit pages, and a shared UI component.

```bash
cd e2e
npm install            # once
npx playwright install chromium   # once
npm test
```

Playwright, driving the real frontend and backend together in a real
browser — the login form, a premises created/edited/deleted through the UI,
and confirming a lower role actually can't see or reach what it shouldn't.
See [`e2e/README.md`](e2e/README.md) for how its fixtures work.

```bash
cd smoke
SMOKE_WEB_URL=https://fire-safety-records.pages.dev npm test
```

Read-only checks against a deployed environment, and **the only suite that may
be pointed at production**. It proves that the environment is up, is serving
the build it is supposed to be, still refuses an unauthenticated read, and
still hands back a `Secure`, `HttpOnly`, `SameSite=Strict` refresh cookie —
the last of which no local run can check, because a Secure cookie is never
sent over plain HTTP. It proves no business rule; that is settled before
anything is promoted. See [`smoke/README.md`](smoke/README.md).

```bash
cd smoke
npm run test:unit
```

The smoke suite's own tests, and the one suite here that needs nothing at
all — no database, no deployment, no credentials. It runs both the suite above
and `wait-for-deploy.mjs` against a stub deployment that can be broken on
purpose, and asserts they go red when it is. A check that decides whether
production is healthy is worth exactly what its own coverage is worth.

### Running a suite against a deployment

The two writing suites default to a working copy — the backend one starts the
app inside the test process, and Playwright starts both dev servers itself.
Either can be pointed at a deployed environment instead, which is what
step 6 of *Making a change* does:

| | |
|---|---|
| `API_BASE_URL` | Sends `backend/tests` at a deployed API instead of one started in-process. |
| `E2E_BASE_URL` | Sends Playwright at a deployed frontend, and stops it starting any dev server. |

Both still insert their fixtures straight into the database, so `DATABASE_URL`
has to name *that* environment's database. The rate limit overrides the suites
set for themselves only reach a process they started, so a deployment being
tested this way needs its own `RATE_LIMIT_LOGIN`, `RATE_LIMIT_REFRESH` and
`RATE_LIMIT_API` raised, or the run will be throttled partway through.

Neither may be aimed at production. Both create and delete real records, and a
run that dies partway leaves them behind.

### In CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs all of the above
except the smoke suite itself on every pull request — the smoke suite's own
tests do run there, since they need nothing — against a Postgres created for
the run — built from `schema.sql` and then migrated, so a migration that
contradicts the schema file fails there rather than on a database that
matters. [`.github/workflows/smoke.yml`](.github/workflows/smoke.yml) waits
for a push to `staging` or `main` to actually deploy, then smokes it.

## Status

- [x] Database schema
- [x] Sample data and seed script
- [x] API — authentication, authorisation, CRUD for every table, the
      business rules, compliance reporting and an audit trail
- [x] Web UI — sign-in, the compliance dashboard, premises, the fire risk
      assessment lifecycle, equipment/escape route check histories, user
      administration and the audit log, plus a generic list/create/edit
      view for every other resource
- [x] End-to-end tests (`e2e/`) — Playwright driving the rendered frontend
      against the real API and database, on top of the frontend's Vitest
      suite covering its logic in isolation
- [x] Deployment safety net — migrations (`backend/src/db/migrations/`), the
      read-only production suite (`smoke/`), a commit reported by
      `/api/health` and stamped into the built frontend so a check can tell
      which build answered it, and CI on every pull request
- [x] Recovery — verified, encrypted backups with a rehearsed restore
      (`npm run backup`, `npm run restore:check`), reversible migrations
      (`npm run migrate:down`), and a runner that refuses a destructive
      migration without an approval and a recent backup

Not yet built out: bulk actions, and an in-app view of the machine-readable
`GET /api/` index.

## Disclaimer

This schema is structured to hold the records the legislation requires,
and the API enforces rules about how those records are kept — but holding
the records is not the same as complying. Whether an assessment is
suitable and sufficient, and whether the fire safety measures are
adequate, is a judgement for a competent person. The API cannot make that
judgement and does not claim to.
