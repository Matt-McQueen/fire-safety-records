# Migrations

Every change to the schema after a database exists goes in here, as a numbered
`.sql` file with a `.down.sql` beside it. `npm run migrate` applies the ones a
database has not seen yet, in filename order, one transaction each.

`schema.sql` and `auth-schema.sql` remain what they were: the definition of a
*fresh* database, used to create one from nothing. They are not a record of how
an existing database got to where it is, which is the job these files do.

## Why not just run the SQL by hand

Because staging and production are separate databases on separate providers
(Neon and Supabase), and promoting a change moves the code and nothing else. A
column added by hand on staging while developing a feature is not added to
production by merging the branch — so the feature works in staging and takes
production down as soon as it deploys, and no amount of testing on staging
would have predicted it. A committed migration, applied as a step of the
promotion, is what makes the schema travel with the code that needs it.

## Writing one

Name it `NNNN_short_description.sql`, four digits, next number up, with its
reversal alongside:

```
0001_add_premises_last_inspected_at.sql
0001_add_premises_last_inspected_at.down.sql
```

Start each file with a comment saying what it is for and, where the change is
not obvious, why — the same standard as the rest of the schema, which cites the
provision each table answers to.

Rules that matter:

- **Expand, then contract.** The API and the frontend deploy independently, and
  a migration lands *before* the code that needs it — so the previous release
  runs against the new schema for a few minutes at least, and has to keep
  working. Add a nullable column now and make it `NOT NULL` in a later release;
  add the new column before dropping the old one; never rename in one step —
  add, backfill, switch the code, drop, as separate promotions.
- **Write the `.down.sql` at the same time.** It is what `npm run migrate:down`
  uses when a promotion has to be taken back, and writing it later means
  writing it during the incident. Reversing an additive migration costs
  nothing: dropping a column that this migration added loses only data that did
  not exist before it. Where a reversal is genuinely impossible, say so in the
  `.down.sql` — a file that explains why beats one that is simply absent.
- **Forward only, once applied.** A migration is never edited after it has run
  anywhere; the runner refuses to continue if a file's checksum has changed,
  because the database no longer matches the file and the next environment
  would get something different from the one that ran it first. Fix a mistake
  with a new migration.
- **One concern per file.** A file that fails halfway is rolled back whole, so
  a smaller file is a smaller thing to reason about at the worst moment.
- **Update `schema.sql` in the same commit.** A fresh database is built from
  that file and must end up identical to a migrated one. CI creates its
  database from `schema.sql` and then runs the migrations over it, so a
  migration that contradicts an updated `schema.sql` fails there rather than in
  production.

## When a migration destroys something

The runner reads every pending migration before it applies any of them, and
refuses the ones that can destroy data or break the running release —
`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, an unscoped `DELETE` or `UPDATE`, a
column type change, `SET NOT NULL`, a rename. Comments and string literals are
ignored, so prose about dropping a column is not a dropped column.

Most of the time the refusal is right and the answer is the additive form
above. When it genuinely has to happen, say so in the file:

```sql
-- destructive: approved by Matt on 2026-09-14 — replaced by incident_notes in
-- 0007, and nothing has read this column since that release.
ALTER TABLE incidents DROP COLUMN legacy_notes;
```

The approval on its own is not enough: against a non-local database the runner
also requires a backup of *that* database, taken within `BACKUP_MAX_AGE_HOURS`
(default 24) and recorded by `npm run backup`. Reverting the deploy reverts the
code; it does not reverse this.

## Running

```bash
cd backend
npm run migrate:status   # what is applied, what is pending — changes nothing
npm run migrate          # apply everything pending
npm run migrate -- --dry-run
npm run migrate:down     # step the most recent one back, using its .down.sql
```

`DATABASE_URL` decides which database is migrated, so check it before running
this against anything that matters. The runner prints the host and database it
is about to change, and takes an advisory lock so two deploys landing together
cannot both apply the same file.
