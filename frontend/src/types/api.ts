// Shapes shared by every endpoint, matching backend/src/http and domain/crud.js.

export type Role = "viewer" | "assessor" | "manager" | "admin";

export const ROLES: Role[] = ["viewer", "assessor", "manager", "admin"];

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  personId: number | null;
  /** null means every premises (admin only). */
  premisesIds: number[] | null;
}

export interface Page {
  limit: number;
  offset: number;
  total?: number;
}

export interface ListResponse<T> {
  data: T[];
  page: Page;
}

export interface ItemResponse<T> {
  data: T;
}

export interface ApiErrorField {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: {
    fields?: ApiErrorField[];
    [key: string]: unknown;
  };
}

/** A record row is a loose bag of columns: every resource shares this shape,
 * plus whatever computed columns its definition joins in. Most are keyed by
 * a numeric `id`; the two reference tables (legal_basis, schedule2_measures)
 * are keyed by a string `code` instead — see ResourceConfig.idColumn. */
export type Row = Record<string, unknown>;

export function rowKey(row: Row, idColumn = "id"): string | number {
  return row[idColumn] as string | number;
}
