// The premises picker that scopes almost every screen in the app. Held here
// rather than in the URL because it follows the user across the whole nav,
// the way "which premises am I looking at" follows a warden around a site
// visit — picking one in Equipment should still apply when they switch to
// Training. The choice is remembered in localStorage purely as a convenience
// for next time; it grants no access on its own, since every request is
// re-scoped by the API to whatever `user_premises` actually allows.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listResource } from "./api";
import type { Row } from "../types/api";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "fsr:selectedPremisesId";

interface PremisesContextValue {
  premises: Row[];
  isLoading: boolean;
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  selected: Row | null;
}

const PremisesContext = createContext<PremisesContextValue | null>(null);

export function PremisesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  const { data, isLoading } = useQuery({
    queryKey: ["premises", "picker"],
    queryFn: () => listResource("/premises", { limit: 200, sort: "name", order: "asc" }),
    enabled: user !== null,
  });

  const premises = useMemo(() => data?.data ?? [], [data]);

  useEffect(() => {
    if (selectedId !== null && premises.length > 0 && !premises.some((p) => p.id === selectedId)) {
      setSelectedIdState(null);
    }
  }, [premises, selectedId]);

  function setSelectedId(id: number | null) {
    setSelectedIdState(id);
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  }

  const selected = premises.find((p) => p.id === selectedId) ?? null;

  return (
    <PremisesContext.Provider value={{ premises, isLoading, selectedId, setSelectedId, selected }}>
      {children}
    </PremisesContext.Provider>
  );
}

export function usePremises(): PremisesContextValue {
  const ctx = useContext(PremisesContext);
  if (!ctx) throw new Error("usePremises must be used within PremisesProvider");
  return ctx;
}
