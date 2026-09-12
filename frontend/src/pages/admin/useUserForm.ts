import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, deactivateUser, getUser, listResource, updateUser } from "../../lib/api";
import { ApiError } from "../../lib/http";
import type { SessionUser } from "../../types/api";

/** Everything UserFormPage needs beyond routing and rendering: the user and
 * premises-picker queries, form state, the create/update/deactivate/unlock
 * mutations, and the derived isSelf/locked/fieldErrors flags. Kept separate
 * so the page component itself only has to handle "what to show". */
export function useUserForm(id: string | undefined, isNew: boolean, me: SessionUser | null) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(Number(id)),
    enabled: !isNew,
  });

  const { data: premisesData } = useQuery({
    queryKey: ["premises", "picker-all"],
    queryFn: () => listResource("/premises", { limit: 200, sort: "name" }),
  });

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [isActive, setIsActive] = useState(true);
  const [premisesIds, setPremisesIds] = useState<number[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data) {
      setEmail(data.data.email);
      setFullName(data.data.full_name);
      setRole(data.data.role);
      setIsActive(data.data.is_active);
      setPremisesIds(data.data.premises_ids);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return createUser({ email, full_name: fullName, password, role, premises_ids: premisesIds });
      }
      return updateUser(Number(id), {
        full_name: fullName,
        role,
        is_active: isActive,
        premises_ids: premisesIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      navigate("/admin/users");
    },
    onError: setError,
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateUser(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      navigate("/admin/users");
    },
    onError: setError,
  });

  const unlockMutation = useMutation({
    mutationFn: () => updateUser(Number(id), { unlock: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", id] }),
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};
  const isSelf = !isNew && me?.id === Number(id);
  const locked = Boolean(data?.data.locked_until && new Date(data.data.locked_until) > new Date());

  return {
    data,
    isLoading,
    premisesData,
    email,
    setEmail,
    fullName,
    setFullName,
    password,
    setPassword,
    role,
    setRole,
    isActive,
    setIsActive,
    premisesIds,
    setPremisesIds,
    error,
    fieldErrors,
    isSelf,
    locked,
    saveMutation,
    deactivateMutation,
    unlockMutation,
  };
}
