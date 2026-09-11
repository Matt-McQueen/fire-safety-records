// Generic CRUD calls against /api/<resource>, matching the five operations
// every resource in backend/src/domain/resource.js exposes, plus the
// hand-written extras (compliance, publish, full, users, audit).

import type { ItemResponse, ListResponse, Row } from "../types/api";
import { request } from "./http";

export interface ListParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
  [filter: string]: string | number | boolean | undefined;
}

export function listResource(path: string, params: ListParams = {}): Promise<ListResponse<Row>> {
  return request<ListResponse<Row>>("GET", path, undefined, { query: params });
}

export function getResource(path: string, id: number | string): Promise<ItemResponse<Row>> {
  return request<ItemResponse<Row>>("GET", `${path}/${id}`);
}

export function createResource(path: string, body: Record<string, unknown>): Promise<ItemResponse<Row>> {
  return request<ItemResponse<Row>>("POST", path, body);
}

export function updateResource(
  path: string,
  id: number | string,
  body: Record<string, unknown>,
): Promise<ItemResponse<Row>> {
  return request<ItemResponse<Row>>("PATCH", `${path}/${id}`, body);
}

export function removeResource(path: string, id: number | string): Promise<void> {
  return request<void>("DELETE", `${path}/${id}`);
}

// --- discovery ---------------------------------------------------------

export interface ApiIndexResource {
  path: string;
  name: string;
  operations: string[];
  permissions: { read: string; create: string; update: string; remove: string };
  filters: string[];
  sortable: string[];
}

export interface ApiIndex {
  resources: ApiIndexResource[];
  extra: { path: string; description: string }[];
}

export function fetchApiIndex(): Promise<ItemResponse<ApiIndex>> {
  return request<ItemResponse<ApiIndex>>("GET", "/");
}

// --- premises extras -----------------------------------------------------

export interface ComplianceCheck {
  key: string;
  provision: string;
  status: "ok" | "attention" | "missing" | "not_required";
  summary: string;
  detail?: Record<string, unknown>;
}

export interface ComplianceReport {
  premises: { id: number; name: string; employee_count: number | null };
  recording_duty_applies: boolean;
  generated_at: string;
  summary: { ok: number; attention: number; missing: number; not_required: number };
  checks: ComplianceCheck[];
  caveat: string;
}

export function fetchCompliance(premisesId: number): Promise<ItemResponse<ComplianceReport>> {
  return request("GET", `/premises/${premisesId}/compliance`);
}

export interface ComplianceSummaryEntry {
  premises: { id: number; name: string; employee_count: number | null };
  recording_duty_applies: boolean;
  summary: { ok: number; attention: number; missing: number; not_required: number };
}

// One request for every premises the caller can reach, rather than the
// dashboard grid firing fetchCompliance once per premises itself - see
// complianceSummaryForAccessiblePremises in the backend for why.
export function fetchComplianceSummary(): Promise<ItemResponse<ComplianceSummaryEntry[]>> {
  return request("GET", "/premises/compliance-summary");
}

// --- fire risk assessment extras -----------------------------------------

export function publishAssessment(
  id: number,
  body: { recorded_on?: string; assessment_type?: "review" | "revision_after_change" } = {},
): Promise<ItemResponse<Row>> {
  return request<ItemResponse<Row>>("POST", `/fire-risk-assessments/${id}/publish`, body);
}

export interface FullAssessment extends Row {
  significant_findings: (Row & { measures: Row[] })[];
  persons_at_risk: Row[];
}

export function fetchFullAssessment(id: number): Promise<ItemResponse<FullAssessment>> {
  return request<ItemResponse<FullAssessment>>("GET", `/fire-risk-assessments/${id}/full`);
}

// --- users -----------------------------------------------------------------

export interface AdminUser extends Row {
  email: string;
  full_name: string;
  role: string;
  person_id: number | null;
  is_active: boolean;
  last_login_at: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  premises_ids: number[];
}

export function listUsers(params: {
  role?: string;
  is_active?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<ListResponse<AdminUser>> {
  return request<ListResponse<AdminUser>>("GET", "/users", undefined, { query: params });
}

export function getUser(id: number): Promise<ItemResponse<AdminUser>> {
  return request<ItemResponse<AdminUser>>("GET", `/users/${id}`);
}

export function createUser(body: Record<string, unknown>): Promise<ItemResponse<AdminUser>> {
  return request<ItemResponse<AdminUser>>("POST", "/users", body);
}

export function updateUser(id: number, body: Record<string, unknown>): Promise<ItemResponse<AdminUser>> {
  return request<ItemResponse<AdminUser>>("PATCH", `/users/${id}`, body);
}

export function deactivateUser(id: number): Promise<ItemResponse<AdminUser>> {
  return request<ItemResponse<AdminUser>>("DELETE", `/users/${id}`);
}

export interface AuditEntry extends Row {
  occurred_at: string;
  user_id: number | null;
  user_email: string | null;
  action: string;
  resource: string | null;
  resource_id: number | null;
  premises_id: number | null;
  outcome: "success" | "denied" | "failure";
  request_id: string | null;
  detail: Record<string, unknown> | null;
}

export function listAuditLog(params: {
  user_id?: number;
  premises_id?: number;
  resource?: string;
  action?: string;
  outcome?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<ListResponse<AuditEntry>> {
  return request<ListResponse<AuditEntry>>("GET", "/users/audit/log", undefined, { query: params });
}
