import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResource, getResource, removeResource, updateResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { usePremises } from "../../lib/PremisesContext";
import { atLeast } from "../../lib/roles";
import type { FormValues } from "../../components/resource/ResourceForm";
import type { ResourceConfig } from "../../resources/types";

/** Everything ResourceFormPage needs beyond routing and rendering: the
 * record query, form state, and the create/update/remove mutations. Kept
 * separate so the page component itself only has to handle "what to show". */
export function useResourceForm(config: ResourceConfig | undefined, id: string | undefined, isNew: boolean) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { selectedId: globalPremisesId } = usePremises();

  const { data, isLoading } = useQuery({
    queryKey: ["resource", config?.name, id],
    queryFn: () => getResource(config!.path, id!),
    enabled: !!config && !isNew,
  });

  const [values, setValues] = useState<FormValues>({});
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    if (data) setValues(data.data);
    else if (isNew && config) {
      const seeded: FormValues = {};
      if (config.premisesScoped && globalPremisesId !== null) seeded.premises_id = globalPremisesId;
      setValues(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isNew, config?.name]);

  const canWrite =
    config !== undefined &&
    user !== null &&
    atLeast(user.role, isNew ? config.permissions.create : config.permissions.update);
  const canRemove = config !== undefined && user !== null && config.removable && atLeast(user.role, config.permissions.remove);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return createResource(config!.path, values);
      return updateResource(config!.path, id!, changedFields(values, data?.data ?? {}, config!.fields));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", config!.name] });
      // Without this, revisiting this same record's edit page serves this
      // page's now-stale copy for up to staleTime (15s, see
      // lib/queryClient.ts) instead of what was just saved - the same gap
      // PremisesFormPage.tsx had for its own single-record query.
      if (!isNew) queryClient.invalidateQueries({ queryKey: ["resource", config!.name, id] });
      navigate(`/records/${config!.name}`);
    },
    onError: (err) => setSubmitError(err),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeResource(config!.path, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", config!.name] });
      navigate(`/records/${config!.name}`);
    },
    onError: (err) => setSubmitError(err),
  });

  return { data, isLoading, values, setValues, submitError, canWrite, canRemove, saveMutation, removeMutation };
}

/** PATCH bodies are partial (backend/src/http/validate.js `partial()`), and
 * an empty body is rejected outright (`assertNotEmpty`), so only fields the
 * user actually touched are sent. */
function changedFields(
  values: FormValues,
  original: FormValues,
  fields: { key: string; createOnly?: boolean }[],
): FormValues {
  const result: FormValues = {};
  for (const field of fields) {
    if (field.createOnly) continue;
    const { key } = field;
    if (values[key] !== original[key]) result[key] = values[key] ?? null;
  }
  return result;
}
