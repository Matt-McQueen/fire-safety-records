import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SessionUser } from "../types/api";
import * as authService from "./authService";
import { getSession, subscribe } from "./session";
import { tryRefresh } from "./http";
import { rank } from "./roles";

interface AuthContextValue {
  user: SessionUser | null;
  /** Still attempting the silent refresh-cookie sign-in on first load. */
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True when the account holds at least this role, admin outranking manager
   * outranking assessor outranking viewer. */
  hasRole: (minimum: SessionUser["role"]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession, getSession);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    tryRefresh().finally(() => setBooting(false));
  }, []);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    booting,
    async login(email, password) {
      await authService.login(email, password);
    },
    async logout() {
      await authService.logout();
    },
    hasRole(minimum) {
      return rank(session?.user.role) >= rank(minimum);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
