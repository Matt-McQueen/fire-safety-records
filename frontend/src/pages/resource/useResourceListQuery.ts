import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listResource } from "../../lib/api";
import { usePremises } from "../../lib/PremisesContext";
import type { ResourceConfig } from "../../resources/types";

const LIMIT = 25;

/** Parses the list page's URL state (offset, sort, order, search, filters),
 * derives the resource-list query, and returns updateParam to write any of
 * it back to the URL. Kept separate so ResourceListPage itself only has to
 * handle "what to show". */
export function useResourceListQuery(config: ResourceConfig | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedId: globalPremisesId } = usePremises();

  const offset = Number(searchParams.get("offset") ?? 0);
  const sort = searchParams.get("sort") ?? config?.defaultSort ?? "";
  const order = (searchParams.get("order") as "asc" | "desc" | null) ?? "asc";
  const q = searchParams.get("q") ?? "";

  const filterValues: Record<string, string> = {};
  for (const filter of config?.filters ?? []) {
    const raw = searchParams.get(filter.param);
    if (raw !== null) filterValues[filter.param] = raw;
    else if (filter.param === "premises_id" && config?.premisesScoped && globalPremisesId !== null) {
      filterValues[filter.param] = String(globalPremisesId);
    }
  }

  const queryParams = useMemo(
    () => ({ limit: LIMIT, offset, sort, order, q: q || undefined, ...filterValues }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offset, sort, order, q, JSON.stringify(filterValues)],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-list", config?.name, queryParams],
    queryFn: () => listResource(config!.path, queryParams),
    enabled: !!config,
  });

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
    // Changing a filter, the search term or the sort starts back at page one;
    // changing the offset itself (Pagination's Next/Previous) must not then
    // wipe out the very change just made.
    if (key !== "offset") next.delete("offset");
    setSearchParams(next);
  }

  return { data, isLoading, error, offset, sort, order, q, filterValues, updateParam, LIMIT };
}
