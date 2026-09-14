# Migrations

Every change to the schema after a database exists goes in here, as a numbered
`.sql` file. `npm run migrate` applies the ones a database has not seen yet,
in filename order, one transaction each.

`schema.sql` and `auth-schema.sql` remain what they were: the definition of a
*fresh* database, used to create one from nothing. They are not a record of
how an existing database got to where it is, which is the job these files do.

## Why not just run the SQL by hand

Because staging and production are separate databases on separate providers
(Neon and Supabase), and promoting a change moves the code and nothing else.
A column added by hand on staging while developing a feature is not added to
production by merging the branch — so the feature works in staging and takes
production down as soon as it deploys, and no amount of testing on staging
would have predicted it. A committed migration, applied as a step of the
promotion, is what makes the schema travel with the code that needs it.

## Writing one

Name it `NNNN_short_description.sql`, four digits, next number up:

```
0001_add_premises_last_inspected_at.sql
```

Start the file with a comment saying what it is for and, where the change is
not obvious, why — the same standard as the rest of the schema, which cites
the provision each table answers to.

Rules that matter:

- **Forward only.** A migration is never edited after it has been applied
  anywhere; the runner refuses to continue if a file's checksum has changed,
  because the database no longer matches the file and the next environment
  would get something different from the one that ran it first. Fix a mistake
  with a new migration.
- **One concern per file.** A file that fails halfway is rolled back whole, so
  a smaller file is a smaller thing to reason about at the worst moment.
- **Expand, then contract.** The API and the frontend deploy independently,
  and a migration lands before the code that needs it. So the old code has to
  keep working against the new schema for a few minutes at least: add a
  nullable column now and make it `NOT NULL` in a later release, add the new
  column before dropping the old one, and never rename in one step — add,
  backfill, switch the code, drop, as separate promotions.
- **Update `schema.sql` in the same commit.** A fresh database is built from
  that file and must end up identical to a migrated one. Nothing checks this
  automatically; CI creates its database from `schema.sql` and then runs the
  migrations over it, so a migration that conflicts with an updated
  `schema.sql` fails there rather than in production.
- **Back up production before applying one.** Reverting a deploy reverts the
  code; it does not revert a migration. Take the snapshot first, every time.

## Running

```bash
cd backend
npm run migrate:status   # what is applied, what is pending — changes nothing
npm run migrate          # apply everything pending
npm run migrate -- --dry-run
```

`DATABASE_URL` decides which database is migrated, so check it before running
this against anything that matters. The runner prints the host and database it
is about to change, and takes an advisory lock so two deploys landing together
cannot both apply the same file.
