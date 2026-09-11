import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { PREMISES_COLUMNS } from "../../resources/premises";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { TextInput } from "../../components/ui/form";

export default function PremisesListPage() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", "premises", q],
    queryFn: () => listResource("/premises", { limit: 200, sort: "name", q: q || undefined }),
  });

  const canCreate = user !== null && atLeast(user.role, "manager");

  return (
    <div>
      <PageHeader
        title="Premises"
        description="Every workplace held in the register, and whether the duty to record a fire risk assessment applies to it."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => navigate("/premises/new")}>
              + New premises
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 w-64">
        <TextInput placeholder="Search premises…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={PREMISES_COLUMNS}
            rows={data?.data ?? []}
            isLoading={isLoading}
            linkTo={(row) => `/premises/${row.id}`}
          />
        </div>
      )}
    </div>
  );
}
