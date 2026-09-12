import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { Select, TextInput } from "../../components/ui/form";
import type { FilterConfig } from "../../resources/types";

/** Renders the control for one list-page filter, branching on its field
 * kind. Extracted from ResourceListPage so the page itself doesn't have to
 * branch on every filter kind inline. */
export function FilterField({
  filter,
  value,
  onChange,
}: {
  filter: FilterConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  if (filter.field.kind === "boolean") {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    );
  }

  if (filter.field.kind === "enum") {
    const { options, labels } = filter.field;
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels?.[opt] ?? opt}
          </option>
        ))}
      </Select>
    );
  }

  if (filter.field.kind === "resource") {
    return (
      <ResourceFilterSelect resourcePath={filter.field.resourcePath} labelKey={filter.field.labelKey} value={value} onChange={onChange} />
    );
  }

  return <TextInput defaultValue={value} onBlur={(e) => onChange(e.target.value)} />;
}

function ResourceFilterSelect({
  resourcePath,
  labelKey,
  value,
  onChange,
}: {
  resourcePath: string;
  labelKey: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["resource-select", resourcePath],
    queryFn: () => listResource(resourcePath, { limit: 200 }),
  });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any</option>
      {(data?.data ?? []).map((row) => (
        <option key={String(row.id)} value={String(row.id)}>
          {String(row[labelKey] ?? row.id)}
        </option>
      ))}
    </Select>
  );
}
