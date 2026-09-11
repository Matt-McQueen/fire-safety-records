// The access token lives in memory only, never in localStorage or a
// non-httpOnly cookie, so a script running on this page (an XSS payload in a
// dependency, say) cannot exfiltrate it at rest — it only ever exists as a
// variable in this module and an Authorization header. The refresh token is
// an httpOnly cookie the backend sets and this code never touches directly.
//
// This is a plain module-level store, not a React context, because the fetch
// client in api.ts needs to read and clear it outside any component.

import type { SessionUser } from "../types/api";

export interface Session {
  accessToken: string;
  user: SessionUser;
}

let session: Session | null = null;
const listeners = new Set<() => void>();

export function getSession(): Session | null {
  return session;
}

export function setSession(next: Session): void {
  session = next;
  for (const listener of listeners) listener();
}

export function clearSession(): void {
  if (session === null) return;
  session = null;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
