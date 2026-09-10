// The CRUD engine.
//
// Twenty-odd tables need the same five operations with the same access control,
// the same pagination and the same audit trail. Writing that out twenty times
// is how one of them ends up missing the premises check. So it is written once
// here and each resource supplies a definition: its table, its scope, its
// schemas, its filters and its business rules.
//
// Everything that varies and reaches SQL — sortable columns, filter columns,
// selectable expressions — is resolved against an allowlist in the definition
// before it is interpolated. Values are always parameters, never interpolated.

import { notFound, ruleViolation } from "../http/errors.js";
import { assertPremisesAccess } from "../auth/middleware.js";
import * as audit from "../audit/auditLog.js";
import { pool, withTransaction } from "../db/db.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// --- reading ---------------------------------------------------------------

export async function list(definition, { user, query, client }) {
  const { table, scope } = definition;
  const params = [];
  const where = [];

  const push = (value) => `$${params.push(value)}`;

  applyPremisesFilter(definition, user, where, push);

  for (const filter of definition.filters ?? []) {
    const value = query[filter.param];
    if (value === undefined) continue;
    if (value === null) {
      where.push(`${filter.column} IS NULL`);
    } else if (Array.isArray(value)) {
      where.push(`${filter.column} = ANY(${push(value)})`);
    } else {
      where.push(`${filter.column} = ${push(value)}`);
    }
  }

  for (const range of definition.dateRanges ?? []) {
    const from = query[`${range.param}_from`];
    const to = query[`${range.param}_to`];
    if (from !== undefined) where.push(`${range.column} >= ${push(from)}`);
    if (to !== undefined) where.push(`${range.column} <= ${push(to)}`);
  }

  if (query.q && definition.search?.length) {
    // The user's text is a parameter; only the column list comes from the
    // definition. Wildcards in the input are escaped so a search for "100%"
    // does not match everything.
    const pattern = push(`%${escapeLike(query.q)}%`);
    const clauses = definition.search.map((column) => `${column} ILIKE ${pattern} ESCAPE '\\'`);
    where.push(`(${clauses.join(" OR ")})`);
  }

  for (const extra of definition.staticFilters ?? []) {
    where.push(extra);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = orderBy(definition, query);

  const limit = clamp(query.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);

  const runner = client ?? pool;

  const { rows } = await runner.query(
    `SELECT ${selectList(definition)}
       FROM ${table} t
       ${scope.joins}
       ${definition.extraJoins ?? ""}
       ${whereSql}
       ${orderSql}
      LIMIT ${push(limit)} OFFSET ${push(offset)}`,
    params,
  );

  // COUNT reuses the same predicate and the same parameters, minus the two
  // added for LIMIT and OFFSET.
  const { rows: countRows } = await runner.query(
    `SELECT count(*)::int AS total
       FROM ${table} t
       ${scope.joins}
       ${definition.extraJoins ?? ""}
       ${whereSql}`,
    params.slice(0, params.length - 2),
  );

  return {
    data: rows.map((row) => present(definition, row)),
    page: { limit, offset, total: countRows[0].total },
  };
}

export async function get(definition, id, { user, client }) {
  const row = await fetchScoped(definition, id, { user, client });
  return present(definition, row);
}

// Fetches one row and refuses it if the user has no access to it.
// Every write path starts here, so an update or delete cannot reach a record
// the caller could not have read.
export async function fetchScoped(definition, id, { user, client, forUpdate = false }) {
  const runner = client ?? pool;
  const { scope } = definition;
  const params = [id];

  // A scope with its own access clause decides in SQL, because the answer is
  // not a single premises id — a person, for instance, is reachable through
  // any of the premises they are connected to.
  // The placeholder is added only if the clause actually uses it: Postgres
  // rejects a statement bound with more parameters than it references.
  let premisesPlaceholder = null;
  const premisesParam = () =>
    (premisesPlaceholder ??= `$${params.push(user.premisesIds)}`);

  const custom =
    scope.accessClause && user.premisesIds !== null
      ? scope.accessClause({ premisesParam, user })
      : null;

  const { rows } = await runner.query(
    `SELECT ${selectList(definition)},
            ${scope.premisesExpr} AS _premises_id
            ${custom ? `, (${custom}) AS _accessible` : ""}
       FROM ${definition.table} t
       ${scope.joins}
       ${definition.extraJoins ?? ""}
      WHERE t.${primaryKey(definition)} = $1
      ${forUpdate ? "FOR UPDATE OF t" : ""}`,
    params,
  );
  const row = rows[0];
  if (!row) throw notFound(`${definition.label} ${id} was not found`);
  if (custom) {
    // 404 rather than 403, for the same reason as elsewhere: a 403 would
    // confirm the record exists.
    if (!row._accessible) throw notFound(`${definition.label} ${id} was not found`);
  } else {
    assertRowAccess(definition, user, row._premises_id);
  }
  return row;
}

// --- writing ---------------------------------------------------------------

export async function create(definition, body, { user, request }) {
  return withTransaction(async (client) => {
    const premisesId = await resolvePremisesForCreate(definition, body, client);
    assertRowAccess(definition, user, premisesId, { reveal: true });

    // The business rules run inside the transaction, so a rule that reads
    // before it writes ("is there already a current assessment here?") cannot
    // be overtaken by a concurrent request.
    const context = { user, client, premisesId, request, definition };
    const values = (await definition.rules?.beforeCreate?.(body, context)) ?? body;

    const columns = Object.keys(values);
    if (columns.length === 0) throw ruleViolation("Nothing to insert");

    const { rows } = await client.query(
      `INSERT INTO ${definition.table} (${columns.map(quote).join(", ")})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
       RETURNING *`,
      columns.map((column) => values[column]),
    );
    const created = rows[0];

    await definition.rules?.afterCreate?.(created, context);

    await audit.record(
      {
        user,
        action: `${definition.name}.create`,
        resource: definition.name,
        resourceId: created.id,
        premisesId,
        request,
        detail: audit.redact(values),
      },
      client,
    );

    return present(definition, await reread(definition, created.id, client));
  });
}

export async function update(definition, id, body, { user, request }) {
  return withTransaction(async (client) => {
    const before = await fetchScoped(definition, id, { user, client, forUpdate: true });

    const context = {
      user,
      client,
      premisesId: before._premises_id,
      request,
      definition,
      before,
    };
    const values = (await definition.rules?.beforeUpdate?.(body, before, context)) ?? body;

    const columns = Object.keys(values);
    if (columns.length === 0) {
      return present(definition, before);
    }

    if (definition.timestamps) values.updated_at = new Date();

    const assignments = Object.keys(values).map(
      (column, index) => `${quote(column)} = $${index + 2}`,
    );
    const { rows } = await client.query(
      `UPDATE ${definition.table} SET ${assignments.join(", ")}
        WHERE ${primaryKey(definition)} = $1 RETURNING *`,
      [id, ...Object.keys(values).map((column) => values[column])],
    );
    const updated = rows[0];

    await definition.rules?.afterUpdate?.(updated, before, context);

    const changes = audit.changedFields(before, values);
    if (Object.keys(changes).length > 0) {
      await audit.record(
        {
          user,
          action: `${definition.name}.update`,
          resource: definition.name,
          resourceId: id,
          premisesId: before._premises_id,
          request,
          detail: { changed: changes },
        },
        client,
      );
    }

    return present(definition, await reread(definition, id, client));
  });
}

export async function remove(definition, id, { user, request }) {
  return withTransaction(async (client) => {
    const before = await fetchScoped(definition, id, { user, client, forUpdate: true });

    // Where a record answers to a statutory duty, deleting it is refused by a
    // rule rather than being possible for anyone with the right role.
    await definition.rules?.beforeDelete?.(before, {
      user,
      client,
      premisesId: before._premises_id,
      request,
      definition,
    });

    await client.query(
      `DELETE FROM ${definition.table} WHERE ${primaryKey(definition)} = $1`,
      [id],
    );

    await audit.record(
      {
        user,
        action: `${definition.name}.delete`,
        resource: definition.name,
        resourceId: id,
        premisesId: before._premises_id,
        request,
        detail: audit.redact(withoutInternals(before)),
      },
      client,
    );
  });
}

// --- helpers ---------------------------------------------------------------

// Which premises a new row will belong to. Either it is named in the body, or
// it is inherited from the parent the body points at — in which case the parent
// must exist, and saying so is not a leak because the caller supplied its id.
async function resolvePremisesForCreate(definition, body, client) {
  const { scope } = definition;
  // Nothing to check here when the resource is not owned by one premises:
  // creation is governed by role alone, and the access clause (or, for the
  // premises table itself, the row being its own premises) governs reads.
  if (scope.unscoped || scope.accessClause || scope.selfPremises) return null;

  if (!scope.parent) {
    const premisesId = body.premises_id ?? null;
    if (premisesId === null) {
      if (scope.nullMeansShared) return null;
      throw ruleViolation("premises_id must be given");
    }
    const { rows } = await client.query("SELECT id FROM premises WHERE id = $1", [premisesId]);
    if (rows.length === 0) throw notFound(`Premises ${premisesId} was not found`);
    return premisesId;
  }

  const parentId = body[scope.parent.key];
  const { rows } = await client.query(scope.parent.premisesSql, [parentId]);
  if (rows.length === 0) {
    throw notFound(scope.parent.missing ?? `The parent record ${parentId} was not found`);
  }
  return rows[0].premises_id;
}

function assertRowAccess(definition, user, premisesId, options) {
  if (definition.scope.unscoped) return;
  // A row shared across the organisation (premises_id NULL, in the tables that
  // allow it) is readable by anyone signed in; who may change it is decided by
  // role, not by premises.
  if (premisesId === null && definition.scope.nullMeansShared) return;
  if (premisesId === null) return;
  assertPremisesAccess(user, premisesId, options);
}

function applyPremisesFilter(definition, user, where, push) {
  const { scope } = definition;
  if (scope.unscoped) return;
  if (user.premisesIds === null) return; // admin

  // Added lazily for the same reason as in fetchScoped: a clause that turns
  // out not to restrict this user must not leave an unused bind parameter.
  let placeholder = null;
  const premisesParam = () => (placeholder ??= push(user.premisesIds));

  if (scope.accessClause) {
    const clause = scope.accessClause({ premisesParam, user });
    if (clause) where.push(clause);
    return;
  }

  where.push(
    scope.nullMeansShared
      ? `(${scope.premisesExpr} IS NULL OR ${scope.premisesExpr} = ANY(${premisesParam()}))`
      : `${scope.premisesExpr} = ANY(${premisesParam()})`,
  );
}

function orderBy(definition, query) {
  const key = primaryKey(definition);
  const sortable = definition.sortable ?? { [key]: `t.${key}` };
  const column = sortable[query.sort] ?? sortable[definition.defaultSort] ?? `t.${key}`;
  const direction = query.order === "asc" ? "ASC" : "DESC";
  // A stable tiebreaker, so paging through equal values does not repeat or skip.
  return `ORDER BY ${column} ${direction} NULLS LAST, t.${key} ${direction}`;
}

// Most tables use a serial `id`. The two reference tables are keyed by their
// statutory code instead, so the column is read from the definition.
function primaryKey(definition) {
  return definition.idColumn ?? "id";
}

function selectList(definition) {
  const extras = definition.computed ?? [];
  return ["t.*", ...extras].join(", ");
}

// After a write, the row is read back through the resource's own select so the
// response carries the same computed columns and joined labels a GET would.
async function reread(definition, id, client) {
  const { rows } = await client.query(
    `SELECT ${selectList(definition)}
       FROM ${definition.table} t
       ${definition.scope.joins}
       ${definition.extraJoins ?? ""}
      WHERE t.${primaryKey(definition)} = $1`,
    [id],
  );
  return rows[0];
}

// Strips the bookkeeping columns the engine adds to a row before it goes out.
function withoutInternals(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith("_")) result[key] = value;
  }
  return result;
}

function present(definition, row) {
  if (!row) return row;
  const visible = withoutInternals(row);
  return definition.present ? definition.present(visible) : visible;
}

// Column names come from the definitions in this codebase, never from a
// request, but they are quoted anyway so a column that collides with a
// reserved word does not become a syntax error later.
function quote(column) {
  return `"${column.replace(/"/g, '""')}"`;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || min, min), max);
}

export { MAX_LIMIT, DEFAULT_LIMIT };
