import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResource } from "../../lib/api";
import { usePremises } from "../../lib/PremisesContext";
import { ApiError } from "../../lib/http";
import { EQUIPMENT_FIELDS } from "../../resources/equipment";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";

export default function EquipmentFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedId } = usePremises();
  const [values, setValues] = useState<FormValues>(() => (selectedId !== null ? { premises_id: selectedId } : {}));
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () => createResource("/equipment", values),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "equipment"] });
      navigate(`/equipment/${result.data.id}`);
    },
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  return (
    <div>
      <PageHeader title="New equipment" breadcrumb={[{ label: "Equipment", to: "/equipment" }, { label: "New" }]} />
      <Card className="max-w-3xl p-6">
        {Boolean(error) && (
          <div className="mb-4">
            <ApiErrorAlert error={error} />
          </div>
        )}
        <ResourceForm
          fields={EQUIPMENT_FIELDS}
          mode="create"
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          fieldErrors={fieldErrors}
        />
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <Button variant="secondary" onClick={() => navigate("/equipment")}>
            Cancel
          </Button>
          <Button variant="success" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Create
          </Button>
        </div>
      </Card>
    </div>
  );
}
