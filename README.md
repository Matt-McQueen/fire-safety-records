# Fire Safety Records

A database of workplace fire safety records for premises in **Scotland**,
with an Express backend (`backend/`) and a React (Vite) frontend
(`frontend/`). The database lives in Supabase.

The schema is in [`backend/src/db/schema.sql`](backend/src/db/schema.sql).
The API and UI are not built yet.

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

Prerequisites: Node.js 18+ and a Supabase project.

1. In the Supabase SQL Editor, run `backend/src/db/schema.sql`.
2. Copy the connection string from Project Settings -> Database ->
   Connection string (URI). Use the **session pooler** unless you are on
   an IPv6 network — direct connections are IPv6-only without the paid
   IPv4 add-on.

```bash
# backend
cd backend
cp .env.example .env   # paste the Supabase connection string into DATABASE_URL
npm install
npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to the backend on port
3001, so open the Vite URL it prints (typically http://localhost:5173).

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

`DATABASE_URL` also works against any other Postgres instance (local or
otherwise) — the pool only enables SSL when the host isn't
`localhost`/`127.0.0.1`.

## Status

- [x] Database schema
- [x] Sample data and seed script
- [ ] API endpoints
- [ ] Web UI

`/api/health` is the only endpoint currently served.

## Disclaimer

This schema is structured to hold the records the legislation requires,
but holding them is not the same as complying. Whether an assessment is
suitable and sufficient, and whether the fire safety measures are
adequate, is a judgement for a competent person.
