// A small inline create/edit form for a record nested under a parent (a
// finding under an assessment, a check under a piece of equipment). Shared
// wherever the API models a one-to-many relationship rather than a flat
// resource list.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createResource, updateResource } from "../../lib/api";
import { ApiError } from "../../lib/http";
import type { Row } from "../../types/api";
import type { FieldConfig } from "../../resources/types";
import { Button } from "../ui/Button";
import { ApiErrorAlert } from "../ui/primitives";
import { ResourceForm } from "./ResourceForm";
import type { FormValues } from "./ResourceForm";

export function ChildRecordForm({
  path,
  fields,
  initialValues,
  recordId,
  parentKey,
  parentId,
  onDone,
  onCancel,
}: {
  path: string;
  fields: FieldConfig[];
  initialValues?: Row;
  recordId?: number;
  parentKey?: string;
  parentId?: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initialValues ?? {});
  const [error, setError] = useState<unknown>(null);
  const isEdit = recordId !== undefined;

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        const body: FormValues = {};
        for (const field of fields) {
          if (values[field.key] !== initialValues?.[field.key]) body[field.key] = values[field.key] ?? null;
        }
        return updateResource(path, recordId!, body);
      }
      return createResource(path, { ...values, ...(parentKey ? { [parentKey]: parentId } : {}) });
    },
    onSuccess: onDone,
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
      {Boolean(error) && (
        <div className="mb-2">
          <ApiErrorAlert error={error} />
        </div>
      )}
      <ResourceForm
        fields={fields}
        mode={isEdit ? "update" : "create"}
        values={values}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        fieldErrors={fieldErrors}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {isEdit ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}
