import type { ReactNode } from "react";
import type { Row } from "../../types/api";
import type { FieldConfig } from "../../resources/types";
import { Card } from "../ui/primitives";
import { AddChildRecordToggle } from "./AddChildRecordToggle";

/** The "Check history" section on a checkable resource's detail page: the
 * list of past checks - rendered per row by the caller, since what a check
 * records differs by resource - and the add-a-check form toggle. Shared by
 * equipment and escape routes, whose check-history sections are otherwise
 * identical. `checks` is passed through as-is from the query (not defaulted
 * to []) so the empty-state message only shows once loading has actually
 * finished. */
export function CheckHistoryList({
  checks,
  renderCheck,
  path,
  fields,
  parentKey,
  parentId,
  canAdd,
  onAdded,
}: {
  checks: Row[] | undefined;
  renderCheck: (check: Row) => ReactNode;
  path: string;
  fields: FieldConfig[];
  parentKey: string;
  parentId: number;
  canAdd: boolean;
  onAdded: () => void;
}) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Check history</h2>
      <div className="space-y-2">
        {(checks ?? []).map((check) => (
          <Card key={String(check.id)} className="p-4">
            {renderCheck(check)}
          </Card>
        ))}
        {checks?.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No checks recorded yet.</p>}
      </div>

      {canAdd && (
        <div className="mt-3">
          <AddChildRecordToggle
            label="+ Record a check"
            path={path}
            fields={fields}
            parentKey={parentKey}
            parentId={parentId}
            onAdded={onAdded}
          />
        </div>
      )}
    </div>
  );
}
