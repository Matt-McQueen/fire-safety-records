import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-slate-400 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <Spinner className="h-8 w-8" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

type AlertTone = "error" | "warning" | "info" | "success";

const ALERT_CLASSES: Record<AlertTone, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${ALERT_CLASSES[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function ApiErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  const fieldErrors =
    error && typeof error === "object" && "fieldErrors" in error
      ? (error as { fieldErrors: Record<string, string> }).fieldErrors
      : {};
  const fields = Object.entries(fieldErrors);
  return (
    <Alert tone="error" title={message}>
      {fields.length > 0 && (
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {fields.map(([field, msg]) => (
            <li key={field}>
              <span className="font-mono text-xs">{field}</span>: {msg}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-14 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {message && <p className="max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumb?: { label: string; to?: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1 flex items-center gap-1.5 text-sm text-slate-400">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span>/</span>}
                {item.to ? (
                  <Link to={item.to} className="hover:text-slate-600 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({
  limit,
  offset,
  total,
  onChange,
}: {
  limit: number;
  offset: number;
  total: number | undefined;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pageCount = total !== undefined ? Math.max(1, Math.ceil(total / limit)) : undefined;
  const hasNext = total === undefined ? true : offset + limit < total;

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
      <p>
        {total !== undefined ? (
          <>
            Showing <span className="font-medium text-slate-700">{Math.min(offset + 1, total)}</span>–
            <span className="font-medium text-slate-700">{Math.min(offset + limit, total)}</span> of{" "}
            <span className="font-medium text-slate-700">{total}</span>
          </>
        ) : (
          `Page ${page}`
        )}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasNext}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
      {pageCount !== undefined && <p className="hidden sm:block">Page {page} of {pageCount}</p>}
    </div>
  );
}
