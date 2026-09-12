import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/http";
import { PREMISES_FIELDS } from "../../resources/premises";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
import { ResourceFormFooter } from "../../components/resource/ResourceFormFooter";
import NotFoundPage from "../NotFoundPage";
import { usePremisesForm } from "./usePremisesForm";

export default function PremisesFormPage() {
  const { id } = useParams();
  const isNew = id === "new" || id === undefined;
  const navigate = useNavigate();

  const { data, isLoading, values, setValues, submitError, canWrite, canRemove, saveMutation, removeMutation } =
    usePremisesForm(id, isNew);

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

        <ResourceFormFooter
          isNew={isNew}
          canWrite={canWrite}
          canRemove={canRemove}
          deleting={removeMutation.isPending}
          onDelete={() => removeMutation.mutate()}
          deleteConfirmMessage="Delete this premises? This is refused while it still holds any records."
          saving={saveMutation.isPending}
          onSave={() => saveMutation.mutate()}
          onCancel={() => navigate(isNew ? "/premises" : `/premises/${id}`)}
        />
      </Card>
    </div>
  );
}
