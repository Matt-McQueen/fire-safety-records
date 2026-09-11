// legal_basis and schedule2_measures: the API only ever lists these (they
// describe the legislation, not a premises), so this is a plain read-only
// table with no create/edit affordances at all.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { findResourceConfig } from "../../resources/configs";
import { listResource } from "../../lib/api";
import { PageHeader, ApiErrorAlert } from "../../components/ui/primitives";
import { ResourceTable } from "../../components/resource/ResourceTable";
import { TextInput } from "../../components/ui/form";
import NotFoundPage from "../NotFoundPage";

export default function ReferenceListPage() {
  const { resourceName } = useParams();
  const config = resourceName ? findResourceConfig(resourceName) : undefined;
  const [q, setQ] = useState("");

  if (!config) return <NotFoundPage />;

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", config.name, q],
    queryFn: () => listResource(config.path, { limit: 200, sort: config.defaultSort, q: q || undefined }),
  });

  return (
    <div>
      <PageHeader title={config.labelPlural} description={config.helpText} />

      {config.searchable && (
        <div className="mb-4 w-64">
          <TextInput placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <ResourceTable
            columns={config.columns}
            rows={data?.data ?? []}
            idColumn={config.idColumn ?? "id"}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}
