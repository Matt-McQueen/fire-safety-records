import type { Role } from "../types/api";

// Mirrors backend/src/auth/middleware.js rank(): position in this list is
// rank, so "at least manager" is a numeric comparison rather than a set of
// role names repeated everywhere a permission check is needed.
const ORDER: Role[] = ["viewer", "assessor", "manager", "admin"];

export function rank(role: Role | undefined | null): number {
  if (!role) return -1;
  return ORDER.indexOf(role);
}

export function atLeast(role: Role | undefined | null, minimum: Role): boolean {
  return rank(role) >= rank(minimum);
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  assessor: "Assessor",
  manager: "Manager",
  admin: "Admin",
};
