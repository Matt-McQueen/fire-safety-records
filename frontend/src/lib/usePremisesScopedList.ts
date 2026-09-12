import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { usePremises } from "./PremisesContext";
import { atLeast } from "./roles";
import type { Role } from "../types/api";

/** The URL/premises-context plumbing shared by the bespoke resource list
 * pages (equipment, escape routes, fire risk assessments): the premises
 * filter derived from either the URL or the globally selected premises, a
 * helper to update one query param without disturbing the others, and the
 * create-button permission check. Each page still owns its own query and
 * any extra filters (equipment type, assessment status, ...). */
export function usePremisesScopedList(createRole: Role) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedId } = usePremises();

  const premisesId = searchParams.get("premises_id") ?? (selectedId !== null ? String(selectedId) : undefined);

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  const canCreate = user !== null && atLeast(user.role, createRole);

  return { searchParams, premisesId, updateParam, canCreate, navigate };
}
