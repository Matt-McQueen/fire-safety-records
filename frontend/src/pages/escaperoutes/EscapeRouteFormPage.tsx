import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResource } from "../../lib/api";
import { usePremises } from "../../lib/PremisesContext";
import { ApiError } from "../../lib/http";
import { ESCAPE_ROUTE_FIELDS } from "../../resources/equipment";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";

export default function EscapeRouteFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedId } = usePremises();
  const [values, setValues] = useState<FormValues>(() => (selectedId !== null ? { premises_id: selectedId } : {}));
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () => createResource("/escape-routes", values),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "escape_routes"] });
      navigate(`/escape-routes/${result.data.id}`);
    },
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  return (
    <div>
      <PageHeader title="New escape route" breadcrumb={[{ label: "Escape routes", to: "/escape-routes" }, { label: "New" }]} />
      <Card className="max-w-3xl p-6">
        {Boolean(error) && (
          <div className="mb-4">
            <ApiErrorAlert error={error} />
          </div>
        )}
        <ResourceForm
          fields={ESCAPE_ROUTE_FIELDS}
          mode="create"
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          fieldErrors={fieldErrors}
        />
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => navigate("/escape-routes")}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Create
          </Button>
        </div>
      </Card>
    </div>
  );
}
