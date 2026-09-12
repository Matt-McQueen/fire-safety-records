import { useNavigate, useParams } from "react-router-dom";
import { findResourceConfig } from "../../resources/configs";
import { ApiError } from "../../lib/http";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import NotFoundPage from "../NotFoundPage";
import { useResourceForm } from "./useResourceForm";

export default function ResourceFormPage() {
  const { resourceName, id } = useParams();
  const config = resourceName ? findResourceConfig(resourceName) : undefined;
  const navigate = useNavigate();

  const isNew = id === "new" || id === undefined;
  const idColumn = config?.idColumn ?? "id";

  const { data, isLoading, values, setValues, submitError, canWrite, canRemove, saveMutation, removeMutation } =
    useResourceForm(config, id, isNew);

  if (!config) return <NotFoundPage />;
  if (config.fields.length === 0) return <NotFoundPage />;

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
