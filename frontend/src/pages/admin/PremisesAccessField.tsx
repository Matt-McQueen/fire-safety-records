import { Checkbox } from "../../components/ui/form";
import type { Row } from "../../types/api";

/** The "which premises can this user reach" checklist, or the explanatory
 * note in its place for an admin (who reaches every premises). Extracted
 * from UserFormPage so the page itself doesn't carry the checklist's own
 * mapping/toggling logic inline. */
export function PremisesAccessField({
  role,
  premises,
  selectedIds,
  onChange,
}: {
  role: string;
  premises: Row[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  if (role === "admin") {
    return <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">An admin account reaches every premises.</p>;
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Premises access</p>
      <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 p-3 sm:grid-cols-2">
        {premises.map((p) => (
          <Checkbox
            key={String(p.id)}
            label={String(p.name)}
            checked={selectedIds.includes(Number(p.id))}
            onChange={(e) => {
              const pid = Number(p.id);
              onChange(e.target.checked ? [...selectedIds, pid] : selectedIds.filter((x) => x !== pid));
            }}
          />
        ))}
      </div>
    </div>
  );
}
