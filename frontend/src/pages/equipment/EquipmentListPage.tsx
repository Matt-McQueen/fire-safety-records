import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { usePremisesScopedList } from "../../lib/usePremisesScopedList";
import { EQUIPMENT_COLUMNS, EQUIPMENT_TYPES } from "../../resources/equipment";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { Select } from "../../components/ui/form";

export default function EquipmentListPage() {
  const { searchParams, premisesId, updateParam, canCreate, navigate } = usePremisesScopedList("assessor");
  const equipmentType = searchParams.get("equipment_type") ?? undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", "equipment", premisesId, equipmentType],
    queryFn: () =>
      listResource("/equipment", { limit: 100, sort: "location", premises_id: premisesId, equipment_type: equipmentType }),
  });

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Fire safety equipment and its check history — SSI 2006/456 reg 12."
        actions={
          canCreate ? (
            <Button variant="success" onClick={() => navigate("/equipment/new")}>
              + New equipment
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 w-56">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Type</label>
        <Select value={equipmentType ?? ""} onChange={(e) => updateParam("equipment_type", e.target.value || undefined)}>
          <option value="">Any</option>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={EQUIPMENT_COLUMNS}
            rows={data?.data ?? []}
            isLoading={isLoading}
            linkTo={(row) => `/equipment/${row.id}`}
          />
        </div>
      )}
    </div>
  );
}
