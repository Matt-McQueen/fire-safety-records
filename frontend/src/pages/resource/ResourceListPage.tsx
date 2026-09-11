import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { findResourceConfig } from "../../resources/configs";
import { listResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { usePremises } from "../../lib/PremisesContext";
import { atLeast } from "../../lib/roles";
import { Button } from "../../components/ui/Button";
import { PageHeader, Pagination, ApiErrorAlert } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { TextInput, Select } from "../../components/ui/form";
import NotFoundPage from "../NotFoundPage";

const LIMIT = 25;

export default function ResourceListPage() {
  const { resourceName } = useParams();
  const config = resourceName ? findResourceConfig(resourceName) : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedId: globalPremisesId } = usePremises();

  if (!config) return <NotFoundPage />;

  const offset = Number(searchParams.get("offset") ?? 0);
  const sort = searchParams.get("sort") ?? config.defaultSort;
  const order = (searchParams.get("order") as "asc" | "desc" | null) ?? "asc";
  const q = searchParams.get("q") ?? "";

  const filterValues: Record<string, string> = {};
  for (const filter of config.filters ?? []) {
    const raw = searchParams.get(filter.param);
    if (raw !== null) filterValues[filter.param] = raw;
    else if (filter.param === "premises_id" && config.premisesScoped && globalPremisesId !== null) {
      filterValues[filter.param] = String(globalPremisesId);
    }
  }

  const queryParams = useMemo(
    () => ({ limit: LIMIT, offset, sort, order, q: q || undefined, ...filterValues }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offset, sort, order, q, JSON.stringify(filterValues)],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", config.name, queryParams],
    queryFn: () => listResource(config.path, queryParams),
  });

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("offset");
    setSearchParams(next);
  }

  const canCreate = user !== null && atLeast(user.role, config.permissions.create);
  const idColumn = config.idColumn ?? "id";

  return (
    <div>
      <PageHeader
        title={config.labelPlural}
        description={config.helpText}
        actions={
          canCreate && config.fields.length > 0 ? (
            <Button variant="primary" onClick={() => navigate(`/records/${config.name}/new`)}>
              + New {config.label.toLowerCase()}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {config.searchable && (
          <div className="w-56">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Search</label>
            <TextInput
              placeholder="Search…"
              defaultValue={q}
              onKeyDown={(e) => {
                if (e.key === "Enter") updateParam("q", (e.target as HTMLInputElement).value);
              }}
              onBlur={(e) => updateParam("q", e.target.value)}
            />
          </div>
        )}

        {(config.filters ?? []).map((filter) => (
          <div key={filter.param} className="w-48">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{filter.label}</label>
            {filter.field.kind === "boolean" ? (
              <Select
                value={filterValues[filter.param] ?? ""}
                onChange={(e) => updateParam(filter.param, e.target.value || undefined)}
              >
                <option value="">Any</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            ) : filter.field.kind === "enum" ? (
              <Select
                value={filterValues[filter.param] ?? ""}
                onChange={(e) => updateParam(filter.param, e.target.value || undefined)}
              >
                <option value="">Any</option>
                {filter.field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {filter.field.kind === "enum" ? (filter.field.labels?.[opt] ?? opt) : opt}
                  </option>
                ))}
              </Select>
            ) : filter.field.kind === "resource" ? (
              <ResourceFilterSelect
                resourcePath={filter.field.resourcePath}
                labelKey={filter.field.labelKey}
                value={filterValues[filter.param] ?? ""}
                onChange={(v) => updateParam(filter.param, v || undefined)}
              />
            ) : (
              <TextInput
                defaultValue={filterValues[filter.param] ?? ""}
                onBlur={(e) => updateParam(filter.param, e.target.value)}
              />
            )}
          </div>
        ))}

        <div className="w-48">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Sort by</label>
          <Select value={sort} onChange={(e) => updateParam("sort", e.target.value)}>
            {config.sortable.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Order</label>
          <Select value={order} onChange={(e) => updateParam("order", e.target.value)}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <ResourceTable
            columns={config.columns}
            rows={data?.data ?? []}
            idColumn={idColumn}
            isLoading={isLoading}
            linkTo={config.fields.length > 0 ? (row) => `/records/${config.name}/${row[idColumn]}` : undefined}
            emptyMessage="No records match the current filters."
          />
          {data && (
            <Pagination
              limit={LIMIT}
              offset={offset}
              total={data.page.total}
              onChange={(next) => updateParam("offset", String(next))}
            />
          )}
        </div>
      )}
    </div>
  );
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
