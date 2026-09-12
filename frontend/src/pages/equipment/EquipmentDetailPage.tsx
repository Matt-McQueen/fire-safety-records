import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getResource, listResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { EQUIPMENT_CHECK_FIELDS, EQUIPMENT_FIELDS, OUTCOME_LABELS } from "../../resources/equipment";
import { Badge, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { DetailField } from "../../components/resource/DetailField";
import { ResourceEditCard } from "../../components/resource/ResourceEditCard";
import { ResourceDeleteButton } from "../../components/resource/ResourceDeleteButton";
import { CheckHistoryList } from "../../components/resource/CheckHistoryList";
import NotFoundPage from "../NotFoundPage";

const CHECKS_PATH = "/equipment-checks";

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const equipmentId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);

  const detailKey = ["resource", "equipment", id];
  const { data, isLoading } = useQuery({ queryKey: detailKey, queryFn: () => getResource("/equipment", equipmentId) });

  const checksKey = ["equipment-checks", equipmentId];
  const checksQuery = useQuery({
    queryKey: checksKey,
    queryFn: () => listResource(CHECKS_PATH, { equipment_id: equipmentId, sort: "performed_on", order: "desc", limit: 100 }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    queryClient.invalidateQueries({ queryKey: checksKey });
    queryClient.invalidateQueries({ queryKey: ["resource-list", "equipment"] });
  };

  const canWrite = user !== null && atLeast(user.role, "assessor");
  const canDelete = user !== null && atLeast(user.role, "manager");

  if (isLoading) return <CenteredSpinner label="Loading…" />;
  if (!data) return <NotFoundPage />;

  const equipment = data.data;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={String(equipment.identifier || equipment.location)}
        breadcrumb={[{ label: "Equipment", to: "/equipment" }, { label: String(equipment.identifier || equipment.location) }]}
        actions={canWrite && <Button onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="neutral">{String(equipment.equipment_type).replace(/_/g, " ")}</Badge>
        {!equipment.in_service && <Badge tone="neutral">Removed from service</Badge>}
        {Boolean(equipment.has_unresolved_defect) && <Badge tone="red">Defect outstanding</Badge>}
        {Boolean(equipment.check_overdue) && <Badge tone="amber">Check overdue</Badge>}
      </div>

      {editing ? (
        <ResourceEditCard
          path="/equipment"
          fields={EQUIPMENT_FIELDS}
          record={equipment}
          onDone={() => {
            setEditing(false);
            invalidate();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Card className="p-6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <DetailField label="Location" value={equipment.location} />
            <DetailField label="Make / model" value={[equipment.make, equipment.model].filter(Boolean).join(" / ") || "—"} />
            <DetailField label="Serial number" value={equipment.serial_number} />
            <DetailField label="Installed on" value={equipment.installed_on} />
            <DetailField label="Standard reference" value={equipment.standard_reference} />
            <DetailField label="Last checked" value={equipment.last_checked_on} />
          </dl>
        </Card>
      )}

      {canDelete && !editing && (
        <div className="mt-3">
          <ResourceDeleteButton
            path="/equipment"
            id={equipmentId}
            confirmMessage="Delete this equipment? Refused if it has a check history."
            onDone={() => {
              invalidate();
              navigate("/equipment");
            }}
          />
        </div>
      )}

      <CheckHistoryList
        checks={checksQuery.data?.data}
        renderCheck={(check) => (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {String(check.performed_on)} — {String(check.check_type)}
              </p>
              {Boolean(check.defects_found) && (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{String(check.defects_found)}</p>
              )}
              {Boolean(check.next_due_on) && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Next due: {String(check.next_due_on)}</p>
              )}
            </div>
            <Badge tone={check.outcome === "pass" ? "green" : check.defect_outstanding ? "red" : "amber"}>
              {OUTCOME_LABELS[String(check.outcome)] ?? String(check.outcome)}
            </Badge>
          </div>
        )}
        path={CHECKS_PATH}
        fields={EQUIPMENT_CHECK_FIELDS}
        parentKey="equipment_id"
        parentId={equipmentId}
        canAdd={canWrite && Boolean(equipment.in_service)}
        onAdded={invalidate}
      />
    </div>
  );
}
