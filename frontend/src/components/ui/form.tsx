import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";

const BASE_INPUT =
  "block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-600 focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-red-600 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-400";

export function FormField({
  label,
  htmlFor,
  required,
  error,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
      {help && !error && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{help}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${BASE_INPUT} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${BASE_INPUT} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${BASE_INPUT} ${props.className ?? ""}`}>
      {props.children}
    </select>
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        {...props}
        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-700 dark:text-red-400 focus:ring-red-600"
      />
      {label}
    </label>
  );
}

/** A <select> populated from another resource — person_id, premises_id and
 * the like — rather than typed as a bare number, or a string `code` for the
 * two reference tables (legal_basis, schedule2_measures). Loads up to 200
 * rows, which is generous for what this points at in a demo of this size. */
export function ResourceSelect({
  id,
  resourcePath,
  idColumn = "id",
  numeric = true,
  labelKey,
  value,
  onChange,
  required,
  allowEmpty = true,
  emptyLabel = "— none —",
  extraParams,
  disabled,
}: {
  id: string;
  resourcePath: string;
  idColumn?: string;
  /** False for a string primary key (schedule2_measures.code etc). */
  numeric?: boolean;
  labelKey: string | ((row: Record<string, unknown>) => string);
  value: number | string | null;
  onChange: (value: number | string | null) => void;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  extraParams?: Record<string, string | number | boolean | undefined>;
  disabled?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["resource-select", resourcePath, extraParams],
    queryFn: () => listResource(resourcePath, { limit: 200, ...extraParams }),
  });

  const options = data?.data ?? [];
  const labelFor = (row: Record<string, unknown>) =>
    typeof labelKey === "function" ? labelKey(row) : String(row[labelKey] ?? row[idColumn]);

  return (
    <Select
      id={id}
      required={required}
      disabled={disabled || isLoading}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? null : numeric ? Number(raw) : raw);
      }}
    >
      {isLoading ? (
        <option>Loading…</option>
      ) : (
        <>
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {options.map((row) => (
            <option key={String(row[idColumn])} value={String(row[idColumn])}>
              {labelFor(row)}
            </option>
          ))}
        </>
      )}
    </Select>
  );
}
