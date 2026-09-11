import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { findResourceConfig } from "../../resources/configs";
import { createResource, getResource, removeResource, updateResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { usePremises } from "../../lib/PremisesContext";
import { atLeast } from "../../lib/roles";
import { ApiError } from "../../lib/http";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";
import NotFoundPage from "../NotFoundPage";

export default function ResourceFormPage() {
  const { resourceName, id } = useParams();
  const config = resourceName ? findResourceConfig(resourceName) : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { selectedId: globalPremisesId } = usePremises();

  const isNew = id === "new" || id === undefined;
  const idColumn = config?.idColumn ?? "id";

  const { data, isLoading } = useQuery({
    queryKey: ["resource", config?.name, id],
    queryFn: () => getResource(config!.path, id!),
    enabled: !!config && !isNew,
  });

  const [values, setValues] = useState<FormValues>({});
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    if (data) setValues(data.data);
    else if (isNew && config) {
      const seeded: FormValues = {};
      if (config.premisesScoped && globalPremisesId !== null) seeded.premises_id = globalPremisesId;
      setValues(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isNew, config?.name]);

  if (!config) return <NotFoundPage />;
  if (config.fields.length === 0) return <NotFoundPage />;

  const canWrite = user !== null && atLeast(user.role, isNew ? config.permissions.create : config.permissions.update);
  const canRemove = user !== null && config.removable && atLeast(user.role, config.permissions.remove);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return createResource(config.path, values);
      return updateResource(config.path, id!, changedFields(values, data?.data ?? {}, config.fields));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", config.name] });
      // Without this, revisiting this same record's edit page serves this
      // page's now-stale copy for up to staleTime (15s, see
      // lib/queryClient.ts) instead of what was just saved - the same gap
      // PremisesFormPage.tsx had for its own single-record query.
      if (!isNew) queryClient.invalidateQueries({ queryKey: ["resource", config.name, id] });
      navigate(`/records/${config.name}`);
    },
    onError: (err) => setSubmitError(err),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeResource(config.path, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", config.name] });
      navigate(`/records/${config.name}`);
    },
    onError: (err) => setSubmitError(err),
  });

  if (!isNew && isLoading) return <CenteredSpinner label="Loading…" />;
  if (!isNew && !data) return <NotFoundPage />;

  const fieldErrors = submitError instanceof ApiError ? submitError.fieldErrors : {};

  return (
    <div>
      <PageHeader
        title={isNew ? `New ${config.label.toLowerCase()}` : `Edit ${config.label.toLowerCase()}`}
        breadcrumb={[{ label: config.labelPlural, to: `/records/${config.name}` }, { label: isNew ? "New" : String(data?.data[idColumn] ?? id) }]}
      />

      <Card className="p-6">
        {Boolean(submitError) && <div className="mb-4"><ApiErrorAlert error={submitError} /></div>}

        <fieldset disabled={!canWrite}>
          <ResourceForm
            fields={config.fields}
            mode={isNew ? "create" : "update"}
            values={values}
            onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            fieldErrors={fieldErrors}
          />
        </fieldset>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
          <div>
            {!isNew && canRemove && (
              <Button
                variant="danger"
                loading={removeMutation.isPending}
                onClick={() => {
                  if (confirm(`Delete this ${config.label.toLowerCase()}? This cannot be undone.`)) {
                    removeMutation.mutate();
                  }
                }}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate(`/records/${config.name}`)}>
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

/** PATCH bodies are partial (backend/src/http/validate.js `partial()`), and
 * an empty body is rejected outright (`assertNotEmpty`), so only fields the
 * user actually touched are sent. */
function changedFields(
  values: FormValues,
  original: FormValues,
  fields: { key: string; createOnly?: boolean }[],
): FormValues {
  const result: FormValues = {};
  for (const field of fields) {
    if (field.createOnly) continue;
    const { key } = field;
    if (values[key] !== original[key]) result[key] = values[key] ?? null;
  }
  return result;
}
