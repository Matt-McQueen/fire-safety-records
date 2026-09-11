import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Row } from "../../types/api";
import type { ColumnConfig } from "../../resources/types";
import { Badge, CenteredSpinner, EmptyState } from "../ui/primitives";

export function ResourceTable({
  columns,
  rows,
  idColumn = "id",
  linkTo,
  isLoading,
  emptyTitle = "Nothing here yet",
  emptyMessage,
}: {
  columns: ColumnConfig[];
  rows: Row[];
  idColumn?: string;
  linkTo?: (row: Row) => string;
  isLoading: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  if (isLoading) return <CenteredSpinner label="Loading…" />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} message={emptyMessage} />;

  function cellContent(col: ColumnConfig, row: Row): ReactNode {
    const badge = col.badge?.(row);
    if (badge) return <Badge tone={badge.tone}>{badge.text}</Badge>;
    const value = col.render ? col.render(row) : formatValue(row[col.key]);
    return value;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const rowId = String(row[idColumn]);
            const href = linkTo?.(row);
            return (
              <tr key={rowId} className={href ? "hover:bg-slate-50" : ""}>
                {columns.map((col) =>
                  href ? (
                    <td key={col.key} className="p-0">
                      <Link to={href} className="block px-4 py-2.5 whitespace-nowrap text-slate-700">
                        {cellContent(col, row)}
                      </Link>
                    </td>
                  ) : (
                    <td key={col.key} className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                      {cellContent(col, row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
