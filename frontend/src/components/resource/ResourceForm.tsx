// Renders an array of FieldConfig as a set of labelled inputs bound to a
// plain values object. Shared by the generic resource pages and every
// bespoke form (premises, fire risk assessments, equipment...) so a field
// type is only ever wired up to an <input> once.

import type { FieldConfig } from "../../resources/types";
import { Checkbox, FormField, ResourceSelect, Select, TextArea, TextInput } from "../ui/form";

export type FormValues = Record<string, unknown>;

function toDateTimeLocal(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  // "2024-03-01T09:30:00+00:00" -> "2024-03-01T09:30" for <input type=datetime-local>.
  return value.slice(0, 16);
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function ResourceForm({
  fields,
  mode,
  values,
  onChange,
  fieldErrors = {},
}: {
  fields: FieldConfig[];
  mode: "create" | "update";
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  fieldErrors?: Record<string, string>;
}) {
  const visible = mode === "create" ? fields : fields.filter((f) => !f.createOnly);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {visible.map((field) => {
        const required = mode === "create" && field.requiredOnCreate;
        const value = values[field.key];
        const error = fieldErrors[field.key];
        const wide = field.field.kind === "textarea";

        return (
          <div key={field.key} className={wide ? "sm:col-span-2" : ""}>
            <FormField label={field.label} htmlFor={field.key} required={required} error={error} help={field.help}>
              {renderControl(field, value, onChange, required)}
            </FormField>
          </div>
        );
      })}
    </div>
  );
}

function renderControl(
  field: FieldConfig,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  required?: boolean,
) {
  const { key, field: kind } = field;

  switch (kind.kind) {
    case "text":
      return (
        <TextInput
          id={key}
          required={required}
          maxLength={kind.maxLength}
          placeholder={kind.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(key, e.target.value)}
        />
      );

    case "textarea":
      return (
        <TextArea
          id={key}
          required={required}
          maxLength={kind.maxLength}
          rows={kind.rows ?? 3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(key, e.target.value)}
        />
      );

    case "number":
      return (
        <TextInput
          id={key}
          type="number"
          required={required}
          min={kind.min}
          max={kind.max}
          step={kind.step ?? 1}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(key, e.target.value === "" ? null : Number(e.target.value))}
        />
      );

    case "boolean":
      return (
        <Checkbox
          label="Yes"
          checked={Boolean(value)}
          onChange={(e) => onChange(key, e.target.checked)}
        />
      );

    case "date":
      return (
        <TextInput
          id={key}
          type="date"
          required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(key, e.target.value === "" ? null : e.target.value)}
        />
      );

    case "datetime":
      return (
        <TextInput
          id={key}
          type="datetime-local"
          required={required}
          value={toDateTimeLocal(value)}
          onChange={(e) => onChange(key, fromDateTimeLocal(e.target.value))}
        />
      );

    case "time":
      return (
        <TextInput
          id={key}
          type="time"
          required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(key, e.target.value === "" ? null : e.target.value)}
        />
      );

    case "enum":
      return (
        <Select
          id={key}
          required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(key, e.target.value === "" ? undefined : e.target.value)}
        >
          <option value="">— select —</option>
          {kind.options.map((option) => (
            <option key={option} value={option}>
              {kind.labels?.[option] ?? option}
            </option>
          ))}
        </Select>
      );

    case "resource":
      return (
        <ResourceSelect
          id={key}
          required={required}
          resourcePath={kind.resourcePath}
          labelKey={kind.labelKey}
          extraParams={field.optionParams}
          value={(value as number | null) ?? null}
          onChange={(v) => onChange(key, v)}
        />
      );

    case "resource-code":
      return (
        <ResourceSelect
          id={key}
          required={required}
          resourcePath={kind.resourcePath}
          idColumn="code"
          numeric={false}
          labelKey={kind.labelKey}
          extraParams={field.optionParams}
          value={(value as string | null) ?? null}
          onChange={(v) => onChange(key, v)}
        />
      );
  }
}
