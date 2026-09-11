import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listUsers } from "../../lib/api";
import { ROLE_LABELS } from "../../lib/roles";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { TextInput, Select } from "../../components/ui/form";
import type { ColumnConfig } from "../../resources/types";
import type { Row } from "../../types/api";

const COLUMNS: ColumnConfig[] = [
  { key: "email", label: "Email" },
  { key: "full_name", label: "Full name" },
  { key: "role", label: "Role", render: (row: Row) => ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? String(row.role) },
  { key: "premises_ids", label: "Premises", render: (row: Row) => (row.role === "admin" ? "All" : String((row.premises_ids as unknown[])?.length ?? 0)) },
  {
    key: "is_active",
    label: "Status",
    badge: (row: Row) => {
      if (!row.is_active) return { text: "Deactivated", tone: "neutral" };
      if (row.locked_until && new Date(String(row.locked_until)) > new Date()) return { text: "Locked", tone: "amber" };
      return { text: "Active", tone: "green" };
    },
  },
];

export default function UsersListPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["users-list", q, role],
    queryFn: () => listUsers({ q: q || undefined, role: role || undefined, limit: 100 }),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Accounts, roles and which premises each may reach."
        actions={
          <Button variant="primary" onClick={() => navigate("/admin/users/new")}>
            + New user
          </Button>
        }
      />

      <div className="mb-4 flex gap-3">
        <div className="w-56">
          <TextInput placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-44">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Any role</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={COLUMNS}
            rows={data?.data ?? []}
            isLoading={isLoading}
            linkTo={(row) => `/admin/users/${row.id}`}
          />
        </div>
      )}
    </div>
  );
}
