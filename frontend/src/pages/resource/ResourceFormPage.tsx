import { useNavigate, useParams } from "react-router-dom";
import { findResourceConfig } from "../../resources/configs";
import { ApiError } from "../../lib/http";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import { ResourceFormFooter } from "../../components/resource/ResourceFormFooter";
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

        <ResourceFormFooter
          isNew={isNew}
          canWrite={canWrite}
          canRemove={canRemove}
          deleting={removeMutation.isPending}
          onDelete={() => removeMutation.mutate()}
          deleteConfirmMessage={`Delete this ${config.label.toLowerCase()}? This cannot be undone.`}
          saving={saveMutation.isPending}
          onSave={() => saveMutation.mutate()}
          onCancel={() => navigate(`/records/${config.name}`)}
        />
      </Card>
    </div>
  );
}
