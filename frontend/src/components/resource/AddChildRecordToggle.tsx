import { useState } from "react";
import type { FieldConfig } from "../../resources/types";
import { Button } from "../ui/Button";
import { ChildRecordForm } from "./ChildRecordForm";

/** The "+ Add X" button that swaps in a ChildRecordForm when clicked, used
 * everywhere a list of nested child records (checks, findings, measures,
 * persons at risk) lets the caller add one more. */
export function AddChildRecordToggle({
  label,
  path,
  fields,
  parentKey,
  parentId,
  variant,
  onAdded,
}: {
  label: string;
  path: string;
  fields: FieldConfig[];
  parentKey: string;
  parentId: number;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <ChildRecordForm
        path={path}
        fields={fields}
        parentKey={parentKey}
        parentId={parentId}
        onDone={() => {
          setAdding(false);
          onAdded();
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  return (
    <Button size="sm" variant={variant} onClick={() => setAdding(true)}>
      {label}
    </Button>
  );
}
