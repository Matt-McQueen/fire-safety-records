import type { Role } from "../../types/api";

export interface NavItem {
  label: string;
  to: string;
  minRole?: Role;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/" },
      { label: "Premises", to: "/premises" },
    ],
  },
  {
    title: "Fire risk assessment",
    items: [{ label: "Fire risk assessments", to: "/fire-risk-assessments" }],
  },
  {
    title: "People",
    items: [
      { label: "People", to: "/records/people" },
      { label: "Safety roles", to: "/records/safety_roles" },
      { label: "Training records", to: "/records/training_records" },
    ],
  },
  {
    title: "Fire safety measures",
    items: [
      { label: "Equipment", to: "/equipment" },
      { label: "Escape routes", to: "/escape-routes" },
      { label: "Fire safety arrangements", to: "/records/fire_safety_arrangements" },
      { label: "Check schedules", to: "/records/check_schedules" },
      { label: "Fire drills", to: "/records/fire_drills" },
    ],
  },
  {
    title: "Policy & information",
    items: [
      { label: "Health & safety policies", to: "/records/health_safety_policies" },
      { label: "Emergency procedures", to: "/records/emergency_procedures" },
      { label: "Information to employees", to: "/records/employee_information_records" },
      { label: "Cooperation records", to: "/records/cooperation_records" },
      { label: "Dangerous substances", to: "/records/dangerous_substances" },
    ],
  },
  {
    title: "Incidents & enforcement",
    items: [
      { label: "Incidents", to: "/records/incidents" },
      { label: "Enforcement notices", to: "/records/enforcement_notices" },
      { label: "Enforcement visits", to: "/records/enforcement_visits" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "Legal basis", to: "/reference/legal_basis" },
      { label: "Schedule 2 measures", to: "/reference/schedule2_measures" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Users", to: "/admin/users", minRole: "admin" },
      { label: "Audit log", to: "/admin/audit-log", minRole: "admin" },
    ],
  },
];
