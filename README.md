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

Not yet built out: bulk actions, and an in-app view of the machine-readable
`GET /api/` index.

## Disclaimer

This schema is structured to hold the records the legislation requires,
and the API enforces rules about how those records are kept — but holding
the records is not the same as complying. Whether an assessment is
suitable and sufficient, and whether the fire safety measures are
adequate, is a judgement for a competent person. The API cannot make that
judgement and does not claim to.
