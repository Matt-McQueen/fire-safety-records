import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResource } from "../../lib/api";
import { usePremises } from "../../lib/PremisesContext";
import { ApiError } from "../../lib/http";
import { FRA_CREATE_FIELDS } from "../../resources/fra";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";

export default function FraFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedId } = usePremises();
  const [values, setValues] = useState<FormValues>(() => (selectedId !== null ? { premises_id: selectedId } : {}));
  const [submitError, setSubmitError] = useState<unknown>(null);

  const saveMutation = useMutation({
    mutationFn: () => createResource("/fire-risk-assessments", values),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "fire_risk_assessments"] });
      navigate(`/fire-risk-assessments/${result.data.id}`);
    },
    onError: (err) => setSubmitError(err),
  });

  const fieldErrors = submitError instanceof ApiError ? submitError.fieldErrors : {};

  return (
    <div>
      <PageHeader
        title="New fire risk assessment"
        breadcrumb={[{ label: "Fire risk assessments", to: "/fire-risk-assessments" }, { label: "New" }]}
        description="Starts as a draft. Publish it once its findings are recorded to make it the current assessment."
      />

      <Card className="max-w-3xl p-6">
        {Boolean(submitError) && (
          <div className="mb-4">
            <ApiErrorAlert error={submitError} />
          </div>
        )}

        <ResourceForm
          fields={FRA_CREATE_FIELDS}
          mode="create"
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          fieldErrors={fieldErrors}
        />

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <Button variant="secondary" onClick={() => navigate("/fire-risk-assessments")}>
            Cancel
          </Button>
          <Button variant="success" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Create draft
          </Button>
        </div>
      </Card>
    </div>
  );
}
