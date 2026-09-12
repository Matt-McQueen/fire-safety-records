import { Button } from "../ui/Button";

/** The Edit / confirm-then-Delete button pair shown under a child record
 * (a finding, a measure, a person at risk, ...) when the viewer may amend
 * it. Deletion always asks first - the message is the only thing that
 * differs between call sites. */
export function EditDeleteButtons({
  onEdit,
  onDelete,
  deleting,
  confirmMessage,
  className = "mt-2 flex gap-2",
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  confirmMessage: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={deleting}
        onClick={() => {
          if (confirm(confirmMessage)) onDelete();
        }}
      >
        Delete
      </Button>
    </div>
  );
}
