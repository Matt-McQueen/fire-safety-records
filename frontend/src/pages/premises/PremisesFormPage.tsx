import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResource, getResource, removeResource, updateResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { ApiError } from "../../lib/http";
import { PREMISES_FIELDS } from "../../resources/premises";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";
import NotFoundPage from "../NotFoundPage";

export default function PremisesFormPage() {
  const { id } = useParams();
  const isNew = id === "new" || id === undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["resource", "premises", id],
    queryFn: () => getResource("/premises", id!),
    enabled: !isNew,
  });

  const [values, setValues] = useState<FormValues>({});
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    if (data) setValues(data.data);
  }, [data]);

  const canWrite = user !== null && atLeast(user.role, isNew ? "manager" : "manager");
  const canRemove = user !== null && atLeast(user.role, "admin");

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return createResource("/premises", values);
      return updateResource("/premises", id!, changedFields(values, data?.data ?? {}));
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "premises"] });
      queryClient.invalidateQueries({ queryKey: ["premises", "picker"] });
      navigate(`/premises/${result.data.id}`);
    },
    onError: (err) => setSubmitError(err),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeResource("/premises", id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "premises"] });
      queryClient.invalidateQueries({ queryKey: ["premises", "picker"] });
      navigate("/premises");
    },
    onError: (err) => setSubmitError(err),
  });

  if (!isNew && isLoading) return <CenteredSpinner label="Loading…" />;
  if (!isNew && !data) return <NotFoundPage />;

  const fieldErrors = submitError instanceof ApiError ? submitError.fieldErrors : {};

  return (
    <div>
      <PageHeader
        title={isNew ? "New premises" : `Edit ${String(data?.data.name)}`}
        breadcrumb={[
          { label: "Premises", to: "/premises" },
          { label: isNew ? "New" : String(data?.data.name) },
        ]}
      />

      <Card className="max-w-3xl p-6">
        {Boolean(submitError) && (
          <div className="mb-4">
            <ApiErrorAlert error={submitError} />
          </div>
        )}

        <fieldset disabled={!canWrite}>
          <ResourceForm
            fields={PREMISES_FIELDS}
            mode={isNew ? "create" : "update"}
            values={values}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            fieldErrors={fieldErrors}
          />
        </fieldset>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            {!isNew && canRemove && (
              <Button
                variant="danger"
                loading={removeMutation.isPending}
                onClick={() => {
                  if (confirm("Delete this premises? This is refused while it still holds any records.")) {
                    removeMutation.mutate();
                  }
                }}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate(isNew ? "/premises" : `/premises/${id}`)}>
              Cancel
            </Button>
            {canWrite && (
              <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {isNew ? "Create" : "Save changes"}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function changedFields(values: FormValues, original: FormValues): FormValues {
  const result: FormValues = {};
  for (const field of PREMISES_FIELDS) {
    const { key } = field;
    if (values[key] !== original[key]) result[key] = values[key] ?? null;
  }
  return result;
}
