import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { usePremisesScopedList } from "../../lib/usePremisesScopedList";
import { FRA_COLUMNS } from "../../resources/fra";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { Select } from "../../components/ui/form";

export default function FraListPage() {
  const { searchParams, premisesId, updateParam, canCreate, navigate } = usePremisesScopedList("assessor");
  const status = searchParams.get("status") ?? undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", "fire_risk_assessments", premisesId, status],
    queryFn: () =>
      listResource("/fire-risk-assessments", {
        limit: 100,
        sort: "carried_out_on",
        order: "desc",
        premises_id: premisesId,
        status,
      }),
  });

  return (
    <div>
      <PageHeader
        title="Fire risk assessments"
        description="Draft, current and superseded assessments. Publishing a draft makes it the recorded assessment and supersedes the last one."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => navigate("/fire-risk-assessments/new")}>
              + New assessment
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-3">
        <div className="w-48">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Status</label>
          <Select value={status ?? ""} onChange={(e) => updateParam("status", e.target.value || undefined)}>
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="current">Current</option>
            <option value="superseded">Superseded</option>
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={FRA_COLUMNS}
            rows={data?.data ?? []}
            isLoading={isLoading}
            linkTo={(row) => `/fire-risk-assessments/${row.id}`}
          />
        </div>
      )}
    </div>
  );
}
