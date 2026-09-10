# Fire Safety Records

A database of workplace fire safety records for premises in **Scotland**,
with an Express backend (`backend/`) and a React (Vite) frontend
(`frontend/`). The database lives in Supabase.

The schema is in [`backend/src/db/schema.sql`](backend/src/db/schema.sql)
and the API in [`backend/src/`](backend/src). The web UI is not built yet.

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
terminal; it is never recoverable, only resettable.

Set `JWT_SECRET` in `.env` before deploying. Outside production a random
key is generated at startup, which means every restart signs everyone out.

`DATABASE_URL` also works against any other Postgres instance — the pool
only enables SSL when the host isn't `localhost`/`127.0.0.1`.

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

## Tests

```bash
cd backend
npm test
```

86 tests covering the authentication flows, the role and premises
boundaries, input handling, and each of the business rules above. They run
against the real database, because premises scoping, transactional rules,
generated columns and foreign keys are not things a stubbed pool would
exercise. Everything a run creates is namespaced and removed afterwards,
so a run leaves the database as it found it.

## Status

- [x] Database schema
- [x] Sample data and seed script
- [x] API — authentication, authorisation, CRUD for every table, the
      business rules, compliance reporting and an audit trail
- [ ] Web UI

`frontend/src/App.jsx` is still the original scaffold and calls
`/api/items`, an endpoint from the demo schema that no longer exists. It
needs rewriting against the API above.

## Disclaimer

This schema is structured to hold the records the legislation requires,
and the API enforces rules about how those records are kept — but holding
the records is not the same as complying. Whether an assessment is
suitable and sufficient, and whether the fire safety measures are
adequate, is a judgement for a competent person. The API cannot make that
judgement and does not claim to.
