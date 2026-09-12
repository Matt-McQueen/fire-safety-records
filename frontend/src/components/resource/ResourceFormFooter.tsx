import { Button } from "../ui/Button";

/** The footer shared by dedicated create-or-update form pages (premises,
 * the generic resource pages): a Delete button for an existing record the
 * viewer may remove, and Cancel / Create-or-"Save changes" on the other
 * side. Distinct from ResourceEditCard, which is a self-contained
 * update-only card a detail page toggles in place of its read view. */
export function ResourceFormFooter({
  isNew,
  canWrite,
  canRemove,
  deleting,
  onDelete,
  deleteConfirmMessage,
  saving,
  onSave,
  onCancel,
}: {
  isNew: boolean;
  canWrite: boolean;
  canRemove: boolean;
  deleting: boolean;
  onDelete: () => void;
  deleteConfirmMessage: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
      <div>
        {!isNew && canRemove && (
          <Button
            variant="danger"
            loading={deleting}
            onClick={() => {
              if (confirm(deleteConfirmMessage)) onDelete();
            }}
          >
            Delete
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {canWrite && (
          <Button variant="primary" loading={saving} onClick={onSave}>
            {isNew ? "Create" : "Save changes"}
          </Button>
        )}
      </div>
    </div>
  );
}
