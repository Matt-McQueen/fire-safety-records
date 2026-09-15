import { useNavigate, useParams } from "react-router-dom";
import { findResourceConfig } from "../../resources/configs";
import type { ResourceConfig } from "../../resources/types";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { Button } from "../../components/ui/Button";
import { PageHeader, Pagination, ApiErrorAlert } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { TextInput, Select } from "../../components/ui/form";
import NotFoundPage from "../NotFoundPage";
import { useResourceListQuery } from "./useResourceListQuery";
import { FilterField } from "./FilterField";

export default function ResourceListPage() {
  const { resourceName } = useParams();
  const config = resourceName ? findResourceConfig(resourceName) : undefined;
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading, error, offset, sort, order, q, filterValues, updateParam, LIMIT } =
    useResourceListQuery(config);

  if (!config) return <NotFoundPage />;

  const canCreate = user !== null && atLeast(user.role, config.permissions.create);
  const idColumn = config.idColumn ?? "id";

  return (
    <div>
      <PageHeader
        title={config.labelPlural}
        description={config.helpText}
        actions={
          canCreate && config.fields.length > 0 ? (
            <Button variant="success" onClick={() => navigate(`/records/${config.name}/new`)}>
              + New {config.label.toLowerCase()}
            </Button>
          ) : undefined
        }
      />

      <ListToolbar config={config} q={q} sort={sort} order={order} filterValues={filterValues} updateParam={updateParam} />

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

// The search box, per-resource filters, and sort/order controls above the
// table - one cohesive toolbar, kept separate from the page's own
// loading/error/pagination layout.
function ListToolbar({
  config,
  q,
  sort,
  order,
  filterValues,
  updateParam,
}: {
  config: ResourceConfig;
  q: string;
  sort: string;
  order: string;
  filterValues: Record<string, string>;
  updateParam: (key: string, value: string | undefined) => void;
}) {
  return (
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
          <FilterField
            filter={filter}
            value={filterValues[filter.param] ?? ""}
            onChange={(v) => updateParam(filter.param, v)}
          />
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
  );
}
