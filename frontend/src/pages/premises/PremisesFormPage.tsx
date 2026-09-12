import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/http";
import { PREMISES_FIELDS } from "../../resources/premises";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { ResourceForm } from "../../components/resource/ResourceForm";
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

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
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
