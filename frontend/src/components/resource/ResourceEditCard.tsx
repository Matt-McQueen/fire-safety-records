import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { updateResource } from "../../lib/api";
import { ApiError } from "../../lib/http";
import type { Row } from "../../types/api";
import type { FieldConfig } from "../../resources/types";
import { Button } from "../ui/Button";
import { ApiErrorAlert, Card } from "../ui/primitives";
import { ResourceForm } from "./ResourceForm";
import type { FormValues } from "./ResourceForm";

/** The "edit this record" card a detail page swaps in for its read-only
 * view: a ResourceForm plus Cancel/Save changes, diffing against the
 * record so the PATCH only ever carries what actually changed. Shared by
 * the bespoke detail pages (equipment, escape routes, ...) that toggle
 * between a view and an edit card rather than always rendering a form. */
export function ResourceEditCard({
  path,
  fields,
  record,
  onDone,
  onCancel,
}: {
  path: string;
  fields: FieldConfig[];
  record: Row;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(record);
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body: FormValues = {};
      for (const field of fields) {
        if (field.createOnly) continue;
        if (values[field.key] !== record[field.key]) body[field.key] = values[field.key] ?? null;
      }
      return updateResource(path, record.id as number, body);
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
        fields={fields}
        mode="update"
        values={values}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        fieldErrors={fieldErrors}
      />
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="success" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}
