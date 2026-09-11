// The low-level HTTP client every request goes through.
//
// It attaches the access token, and — because the token is short-lived by
// design (15 minutes) — transparently refreshes it once on a 401 and retries
// the original request, rather than making every screen in the app handle
// that itself. A second 401 after a refresh means the session is really
// over, so it clears state and lets the caller's UI fall back to the login
// screen (see ProtectedRoute).

import type { ApiErrorBody, SessionUser } from "../types/api";
import { clearSession, getSession, setSession } from "./session";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorBody["details"];
  requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  /** The per-field messages a 400 validation failure carries, if any. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.fields;
    if (!Array.isArray(fields)) return {};
    const result: Record<string, string> = {};
    for (const { field, message } of fields) result[field] = message;
    return result;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Exchanges the refresh cookie for a new access token. Shared by the app's
 * startup check and by the retry-on-401 path below, so two callers racing
 * each other only ever trigger one network call. */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        const body = (await res.json()) as {
          data: { accessToken: string; user: SessionUser };
        };
        setSession({ accessToken: body.data.accessToken, user: body.data.user });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Set on the /api/auth/* calls, which must not themselves trigger a
   * refresh-and-retry loop. */
  isAuthEndpoint?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`/api${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

async function raw(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {};
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  return fetch(buildUrl(path, options.query), {
    method,
    headers,
    credentials: "include",
    signal: options.signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let res = await raw(method, path, body, options);

  if (res.status === 401 && !options.isAuthEndpoint) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await raw(method, path, body, options);
    } else {
      clearSession();
    }
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : undefined;

  if (!res.ok) {
    if (res.status === 401) clearSession();
    const errorBody: ApiErrorBody = payload?.error ?? {
      code: "unknown",
      message: res.statusText || "Request failed",
    };
    throw new ApiError(res.status, errorBody);
  }

  return payload as T;
}
