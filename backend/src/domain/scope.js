// How a record is connected to a premises.
//
// Access control is per premises, so every table has to answer "which premises
// does this row belong to?". Some carry premises_id directly; the rest reach it
// through a parent, and a couple through two parents. The scope declares the
// joins once and the CRUD engine uses them for listing, fetching, updating and
// deleting alike.
//
// Every string here is written in this file. None of it is ever derived from a
// request, so nothing a client sends can reach a query as SQL.

// A table with its own premises_id column. The premises is named directly in
// the body when the record is created.
export const ownPremises = {
  joins: "",
  premisesExpr: "t.premises_id",
  parent: null,
};

// A table whose premises is reached through a parent row. `key` is the foreign
// key column on this table; `joins` and `premisesExpr` locate the premises for
// list and fetch queries; `premisesSql` resolves it from the parent's id alone,
// which is what a create needs before the row exists.
export function throughParent({ key, joins, premisesExpr, premisesSql, missing }) {
  return {
    joins,
    premisesExpr,
    parent: { key, premisesSql, missing },
  };
}

// The common single-hop case: this table's `key` points at `table`, which has
// premises_id.
export function throughTable({ table, key, alias = "p", missing }) {
  return throughParent({
    key,
    joins: `JOIN ${table} ${alias} ON ${alias}.id = t.${key}`,
    premisesExpr: `${alias}.premises_id`,
    premisesSql: `SELECT premises_id FROM ${table} WHERE id = $1`,
    missing,
  });
}

// A table with an optional premises_id: the reference data that may be defined
// once for the whole organisation (premises_id NULL) or per premises.
// Organisation-wide rows are visible to everyone and editable by managers only.
export const optionalPremises = {
  joins: "",
  premisesExpr: "t.premises_id",
  parent: null,
  nullMeansShared: true,
};

// The premises table itself. A premises row is its own premises, so there is no
// parent to resolve when one is created: who may create it is decided by role,
// and the creator is granted access to it afterwards.
export const selfPremises = {
  joins: "",
  premisesExpr: "t.id",
  parent: null,
  selfPremises: true,
};

// Reference tables that belong to no premises at all.
export const noPremises = {
  joins: "",
  premisesExpr: "NULL::integer",
  parent: null,
  unscoped: true,
};
