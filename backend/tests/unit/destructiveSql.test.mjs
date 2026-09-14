// Unit tests for scripts/lib/destructive-sql.mjs: what the migration runner
// will and will not apply without an explicit approval and a fresh backup.
//
// The false positives matter as much as the true ones here. This codebase
// comments heavily — schema.sql cites the provision behind nearly every table
// and column — so a scanner that trips on the word "drop" in a sentence would
// make every other migration need an approval line, and an approval everything
// needs is an approval nobody reads.

import test from "node:test";
import assert from "node:assert/strict";
import {
  findDestructiveStatements,
  hasDestructiveApproval,
  stripSqlNoise,
} from "../../scripts/lib/destructive-sql.mjs";

const kinds = (sql) => findDestructiveStatements(sql).map((finding) => finding.kind);

// --- what must be caught -----------------------------------------------------

test("dropping a table, a column or a view is destructive", () => {
  assert.deepEqual(kinds("DROP TABLE incidents;"), ["drop-table"]);
  assert.deepEqual(kinds("ALTER TABLE people DROP COLUMN job_title;"), ["drop-column"]);
  assert.deepEqual(kinds("DROP VIEW premises_recording_duty;"), ["drop-view"]);
  assert.deepEqual(kinds("DROP MATERIALIZED VIEW compliance_cache;"), ["drop-view"]);
});

test("a column dropped without the COLUMN keyword is still a dropped column", () => {
  // Postgres accepts this spelling, and a scanner that only knows the long
  // form would wave it through.
  assert.deepEqual(kinds("ALTER TABLE people DROP job_title;"), ["drop-column"]);
});

test("emptying or rewriting a whole table is destructive", () => {
  assert.deepEqual(kinds("TRUNCATE audit_log;"), ["truncate"]);
  assert.deepEqual(kinds("DELETE FROM audit_log;"), ["unscoped-delete"]);
  assert.deepEqual(kinds("UPDATE people SET is_employee = false;"), ["unscoped-update"]);
});

test("a change that breaks the release still running is destructive too", () => {
  // Nothing is deleted by any of these; the previous release stops working,
  // which from a user's side is the same morning.
  assert.deepEqual(kinds("ALTER TABLE people ALTER COLUMN full_name TYPE VARCHAR(50);"), [
    "column-type-change",
  ]);
  assert.deepEqual(kinds("ALTER TABLE people ALTER COLUMN job_title SET NOT NULL;"), [
    "set-not-null",
  ]);
  assert.deepEqual(kinds("ALTER TABLE people RENAME COLUMN full_name TO name;"), ["rename"]);
  assert.deepEqual(kinds("ALTER TABLE people RENAME TO persons;"), ["rename"]);
});

// --- what must not be caught -------------------------------------------------

test("an additive migration is not destructive", () => {
  const sql = `
    -- Records the date a premises was last inspected by the enforcing
    -- authority (Fire (Scotland) Act 2005 s.61). Nullable: the column is
    -- added before the code that writes it, and the previous release must
    -- keep working against it.
    ALTER TABLE premises ADD COLUMN last_inspected_on DATE;
    CREATE INDEX idx_premises_last_inspected ON premises (last_inspected_on);
  `;
  assert.deepEqual(kinds(sql), []);
});

test("prose mentioning a drop is prose, not a DROP", () => {
  const sql = `
    -- This does not drop the old column; a later migration will, once nothing
    -- reads it. Do not TRUNCATE anything here. See the note about DELETE FROM
    -- audit_log in the migrations README.
    ALTER TABLE premises ADD COLUMN employee_count_confirmed BOOLEAN DEFAULT false;
  `;
  assert.deepEqual(kinds(sql), []);
});

test("a string literal containing SQL keywords is data, not a statement", () => {
  const sql = `INSERT INTO legal_basis (code, provision) VALUES ('x', 'DROP TABLE guidance');`;
  assert.deepEqual(kinds(sql), []);
});

test("a function body is skipped whole", () => {
  const sql = `
    CREATE FUNCTION note() RETURNS text AS $$
      BEGIN
        RETURN 'DROP TABLE people';
      END;
    $$ LANGUAGE plpgsql;
  `;
  assert.deepEqual(kinds(sql), []);
});

test("dropping a constraint or a default is not dropping data", () => {
  assert.deepEqual(kinds("ALTER TABLE people DROP CONSTRAINT people_name_key;"), []);
  assert.deepEqual(kinds("ALTER TABLE people ALTER COLUMN job_title DROP DEFAULT;"), []);
  assert.deepEqual(kinds("ALTER TABLE people ALTER COLUMN job_title DROP NOT NULL;"), []);
});

test("a scoped delete or update is not flagged", () => {
  assert.deepEqual(kinds("DELETE FROM audit_log WHERE occurred_at < now() - interval '3 years';"), []);
  assert.deepEqual(kinds("UPDATE people SET is_employee = false WHERE ended_on IS NOT NULL;"), []);
});

// --- the approval marker -----------------------------------------------------

test("an approval is only recognised on its own comment line, with a reason", () => {
  assert.equal(
    hasDestructiveApproval("-- destructive: approved by Matt on 2026-09-14 - column unread since 1.4\nDROP TABLE x;"),
    true,
  );
  assert.equal(hasDestructiveApproval("DROP TABLE x;"), false);
  // No reason given.
  assert.equal(hasDestructiveApproval("-- destructive: approved\nDROP TABLE x;"), false);
  // Not in a comment, so not a marker - and not valid SQL either.
  assert.equal(hasDestructiveApproval("destructive: approved by Matt\nDROP TABLE x;"), false);
});

// --- the stripper itself -----------------------------------------------------

test("nested block comments are stripped whole", () => {
  const stripped = stripSqlNoise("/* outer /* inner DROP TABLE x; */ still comment */ SELECT 1;");
  assert.ok(!/DROP/i.test(stripped));
  assert.match(stripped, /SELECT 1;/);
});

test("an escaped quote inside a literal does not end it", () => {
  const stripped = stripSqlNoise("SELECT 'it''s not a DROP TABLE', id FROM people;");
  assert.ok(!/DROP/i.test(stripped));
  assert.match(stripped, /FROM people;/);
});
