import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { usePremisesScopedList } from "../../lib/usePremisesScopedList";
import { ESCAPE_ROUTE_COLUMNS } from "../../resources/equipment";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";

export default function EscapeRouteListPage() {
  const { premisesId, canCreate, navigate } = usePremisesScopedList("manager");

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", "escape_routes", premisesId],
    queryFn: () => listResource("/escape-routes", { limit: 100, sort: "name", premises_id: premisesId }),
  });

  return (
    <div>
      <PageHeader
        title="Escape routes"
        description="SSI 2006/456 reg 13 — routes kept clear and available for use."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => navigate("/escape-routes/new")}>
              + New escape route
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={ESCAPE_ROUTE_COLUMNS}
            rows={data?.data ?? []}
            isLoading={isLoading}
            linkTo={(row) => `/escape-routes/${row.id}`}
          />
        </div>
      )}
    </div>
  );
}
