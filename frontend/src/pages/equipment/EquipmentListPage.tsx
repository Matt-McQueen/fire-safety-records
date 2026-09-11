import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { usePremises } from "../../lib/PremisesContext";
import { atLeast } from "../../lib/roles";
import { EQUIPMENT_COLUMNS, EQUIPMENT_TYPES } from "../../resources/equipment";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, PageHeader } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { Select } from "../../components/ui/form";

export default function EquipmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedId } = usePremises();

  const premisesId = searchParams.get("premises_id") ?? (selectedId !== null ? String(selectedId) : undefined);
  const equipmentType = searchParams.get("equipment_type") ?? undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", "equipment", premisesId, equipmentType],
    queryFn: () =>
      listResource("/equipment", { limit: 100, sort: "location", premises_id: premisesId, equipment_type: equipmentType }),
  });

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  const canCreate = user !== null && atLeast(user.role, "assessor");

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Fire safety equipment and its check history — SSI 2006/456 reg 12."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => navigate("/equipment/new")}>
              + New equipment
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 w-56">
        <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
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
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
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
