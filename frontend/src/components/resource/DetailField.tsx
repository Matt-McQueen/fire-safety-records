/** One label/value pair in a read-only detail view, "—" for anything unset.
 * Shared by the bespoke resource detail pages (equipment, escape routes)
 * that render their fields individually rather than from a generic list. */
export function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-200">{value ? String(value) : "—"}</dd>
    </div>
  );
}
