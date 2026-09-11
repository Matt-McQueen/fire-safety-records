import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getResource, listResource, removeResource, updateResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { ApiError } from "../../lib/http";
import { EQUIPMENT_CHECK_FIELDS, EQUIPMENT_FIELDS, OUTCOME_LABELS } from "../../resources/equipment";
import { Badge, Card, CenteredSpinner, PageHeader, ApiErrorAlert } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";
import { ChildRecordForm } from "../../components/resource/ChildRecordForm";
import NotFoundPage from "../NotFoundPage";

const CHECKS_PATH = "/equipment-checks";

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const equipmentId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [addingCheck, setAddingCheck] = useState(false);

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
        <EditCard
          equipment={equipment}
          onDone={() => {
            setEditing(false);
            invalidate();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Card className="p-6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Location" value={equipment.location} />
            <Field label="Make / model" value={[equipment.make, equipment.model].filter(Boolean).join(" / ") || "—"} />
            <Field label="Serial number" value={equipment.serial_number} />
            <Field label="Installed on" value={equipment.installed_on} />
            <Field label="Standard reference" value={equipment.standard_reference} />
            <Field label="Last checked" value={equipment.last_checked_on} />
          </dl>
        </Card>
      )}

      {canDelete && !editing && (
        <div className="mt-3">
          <DeleteButton
            equipmentId={equipmentId}
            onDone={() => {
              invalidate();
              navigate("/equipment");
            }}
          />
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Check history</h2>
        <div className="space-y-2">
          {(checksQuery.data?.data ?? []).map((check) => (
            <Card key={String(check.id)} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{String(check.performed_on)} — {String(check.check_type)}</p>
                  {Boolean(check.defects_found) && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{String(check.defects_found)}</p>}
                  {Boolean(check.next_due_on) && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Next due: {String(check.next_due_on)}</p>}
                </div>
                <Badge tone={check.outcome === "pass" ? "green" : check.defect_outstanding ? "red" : "amber"}>
                  {OUTCOME_LABELS[String(check.outcome)] ?? String(check.outcome)}
                </Badge>
              </div>
            </Card>
          ))}
          {checksQuery.data?.data.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No checks recorded yet.</p>}
        </div>

        {canWrite && Boolean(equipment.in_service) && (
          <div className="mt-3">
            {addingCheck ? (
              <ChildRecordForm
                path={CHECKS_PATH}
                fields={EQUIPMENT_CHECK_FIELDS}
                parentKey="equipment_id"
                parentId={equipmentId}
                onDone={() => {
                  setAddingCheck(false);
                  invalidate();
                }}
                onCancel={() => setAddingCheck(false)}
              />
            ) : (
              <Button size="sm" onClick={() => setAddingCheck(true)}>
                + Record a check
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-200">{value ? String(value) : "—"}</dd>
    </div>
  );
}

function EditCard({
  equipment,
  onDone,
  onCancel,
}: {
  equipment: Record<string, unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(equipment);
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body: FormValues = {};
      for (const field of EQUIPMENT_FIELDS) {
        if (field.createOnly) continue;
        if (values[field.key] !== equipment[field.key]) body[field.key] = values[field.key] ?? null;
      }
      return updateResource("/equipment", equipment.id as number, body);
    },
    onSuccess: onDone,
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  return (
    <Card className="p-6">
      {Boolean(error) && (
        <div className="mb-4">
          <ApiErrorAlert error={error} />
        </div>
      )}
      <ResourceForm
        fields={EQUIPMENT_FIELDS}
        mode="update"
        values={values}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        fieldErrors={fieldErrors}
      />
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}

function DeleteButton({ equipmentId, onDone }: { equipmentId: number; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: () => removeResource("/equipment", equipmentId),
    onSuccess: onDone,
    onError: setError,
  });
  return (
    <div>
      {Boolean(error) && <ApiErrorAlert error={error} />}
      <Button
        variant="danger"
        loading={mutation.isPending}
        onClick={() => {
          if (confirm("Delete this equipment? Refused if it has a check history.")) mutation.mutate();
        }}
      >
        Delete
      </Button>
    </div>
  );
}
