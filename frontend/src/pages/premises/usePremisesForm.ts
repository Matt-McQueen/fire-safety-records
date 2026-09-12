import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResource, getResource, removeResource, updateResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { PREMISES_FIELDS } from "../../resources/premises";
import type { FormValues } from "../../components/resource/ResourceForm";

/** Everything PremisesFormPage needs beyond routing and rendering: the
 * record query, form state, and the create/update/remove mutations. Kept
 * separate so the page component itself only has to handle "what to show". */
export function usePremisesForm(id: string | undefined, isNew: boolean) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["resource", "premises", id],
    queryFn: () => getResource("/premises", id!),
    enabled: !isNew,
  });

  const [values, setValues] = useState<FormValues>({});
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    if (data) setValues(data.data);
  }, [data]);

  const canWrite = user !== null && atLeast(user.role, isNew ? "manager" : "manager");
  const canRemove = user !== null && atLeast(user.role, "admin");

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return createResource("/premises", values);
      return updateResource("/premises", id!, changedFields(values, data?.data ?? {}));
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "premises"] });
      queryClient.invalidateQueries({ queryKey: ["premises", "picker"] });
      // Without this, the detail page - keyed the same as this page's own
      // query - serves this page's now-stale copy for up to staleTime (15s,
      // see lib/queryClient.ts) instead of what was just saved.
      queryClient.invalidateQueries({ queryKey: ["resource", "premises", String(result.data.id)] });
      navigate(`/premises/${result.data.id}`);
    },
    onError: (err) => setSubmitError(err),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeResource("/premises", id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-list", "premises"] });
      queryClient.invalidateQueries({ queryKey: ["premises", "picker"] });
      navigate("/premises");
    },
    onError: (err) => setSubmitError(err),
  });

  return { data, isLoading, values, setValues, submitError, canWrite, canRemove, saveMutation, removeMutation };
}

function changedFields(values: FormValues, original: FormValues): FormValues {
  const result: FormValues = {};
  for (const field of PREMISES_FIELDS) {
    const { key } = field;
    if (values[key] !== original[key]) result[key] = values[key] ?? null;
  }
  return result;
}
