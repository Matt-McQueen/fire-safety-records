import { Button } from "../../components/ui/Button";

interface Action {
  isPending: boolean;
  mutate: () => void;
}

/** The deactivate/cancel/save button row. Extracted from UserFormPage so the
 * deactivate button's not-self, not-new conditional doesn't live in the
 * page's own render. */
export function UserFormFooter({
  isNew,
  isSelf,
  deactivateMutation,
  saveMutation,
  onCancel,
}: {
  isNew: boolean;
  isSelf: boolean;
  deactivateMutation: Action;
  saveMutation: Action;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
      <div>
        {!isNew && !isSelf && (
          <Button
            variant="danger"
            loading={deactivateMutation.isPending}
            onClick={() => {
              if (confirm("Deactivate this account? Its sessions will be signed out.")) {
                deactivateMutation.mutate();
              }
            }}
          >
            Deactivate
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {isNew ? "Create" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
