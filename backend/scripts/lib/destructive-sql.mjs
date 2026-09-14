// Finds the statements in a migration that can destroy data or break the
// release currently running.
//
// The point is not to forbid these — sometimes a column really does have to
// go — but to stop one arriving by accident. A destructive migration has to
// say so in the file, and the runner will not apply it without a verified
// backup of the database it is about to change (see migrate.mjs).
//
// "Destructive" here is wider than "deletes rows". The API and the frontend
// deploy independently and a migration lands before the code that needs it, so
// for a few minutes the *previous* release is running against the new schema.
// A renamed column or a newly NOT NULL one destroys nothing and still takes
// that release down, which is the same outcome from the user's side. Hence
// expand-then-contract: add now, tighten a release later.

// Comments and string literals are removed first, because this codebase
// comments heavily — schema.sql cites the provision behind nearly every table
// — and a sentence containing the word "drop" is not a DROP.
export function stripSqlNoise(sql) {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }

    if (two === "/*") {
      // Postgres block comments nest, so this counts rather than searching for
      // the first close.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") {
          depth += 1;
          i += 2;
        } else if (sql.slice(i, i + 2) === "*/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    if (sql[i] === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2; // an escaped quote inside the literal
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }

    // Dollar quoting ($$ ... $$ or $tag$ ... $tag$), which is how function
    // bodies are written and can contain anything at all.
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end === -1 ? sql.length : end + tag.length;
      out += " ";
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

// Each entry says what was found and why it counts, so the refusal can explain
// itself rather than just saying no.
const PATTERNS = [
  {
    kind: "drop-table",
    pattern: /\bDROP\s+(?:FOREIGN\s+)?TABLE\b/i,
    why: "removes a table and every row in it",
  },
  {
    kind: "drop-column",
    pattern: /\bDROP\s+COLUMN\b/i,
    why: "removes a column and the values in it",
  },
  {
    kind: "drop-column",
    // Postgres allows the COLUMN keyword to be left out. CONSTRAINT, DEFAULT,
    // NOT NULL and IDENTITY are the other things ALTER TABLE can drop, and
    // none of them destroys data.
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+(?!COLUMN|CONSTRAINT|DEFAULT|NOT\s+NULL|IDENTITY|EXPRESSION)\w/i,
    why: "removes a column and the values in it",
  },
  {
    kind: "drop-view",
    pattern: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/i,
    why: "removes a view the running release may be reading",
  },
  {
    kind: "drop-schema",
    pattern: /\bDROP\s+(?:SCHEMA|DATABASE|TYPE|EXTENSION)\b/i,
    why: "removes an object the running release may depend on",
  },
  {
    kind: "truncate",
    pattern: /\bTRUNCATE\b/i,
    why: "empties a table",
  },
  {
    kind: "unscoped-delete",
    pattern: /\bDELETE\s+FROM\s+[^;]*?;/i,
    test: (statement) => !/\bWHERE\b/i.test(statement),
    why: "deletes every row in the table (no WHERE clause)",
  },
  {
    kind: "unscoped-update",
    pattern: /\bUPDATE\s+[^;]*?\bSET\b[^;]*?;/i,
    test: (statement) => !/\bWHERE\b/i.test(statement),
    why: "rewrites every row in the table (no WHERE clause)",
  },
  {
    kind: "column-type-change",
    pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i,
    why: "changes a column's type, which can silently truncate or fail to cast",
  },
  {
    kind: "set-not-null",
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    why: "rejects the NULLs the running release is still allowed to write",
  },
  {
    kind: "rename",
    pattern: /\bRENAME\s+(?:COLUMN\s+|TO\b)/i,
    why: "breaks the running release, which is still using the old name",
  },
];

export function findDestructiveStatements(sql) {
  const cleaned = stripSqlNoise(sql);
  const findings = [];

  for (const { kind, pattern, test, why } of PATTERNS) {
    const match = pattern.exec(cleaned);
    if (!match) continue;
    if (test && !test(match[0])) continue;
    findings.push({ kind, why, statement: summarise(match[0]) });
  }

  return findings;
}

// A migration says it meant it with a line like:
//
//   -- destructive: approved by Matt on 2026-09-14 — the column has been
//   -- unread since release 1.4 and its data is in incident_notes
//
// Read from the raw file rather than the stripped copy, since it lives in a
// comment. The reason is not parsed, only required to be there: the value is
// in having had to write it down.
export function hasDestructiveApproval(sql) {
  return /^\s*--\s*destructive:\s*approved\b.+/im.test(sql);
}

function summarise(statement) {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 87)}...` : flat;
}
