import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, tryRefresh } from "./http";
import { clearSession, getSession, setSession } from "./session";
import type { SessionUser } from "../types/api";

const user: SessionUser = {
  id: 1,
  email: "jsmith@example.test",
  fullName: "J Smith",
  role: "viewer",
  personId: null,
  premisesIds: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe("ApiError", () => {
  it("carries the status and the body's code, message, details and requestId", () => {
    const error = new ApiError(422, {
      code: "rule_violation",
      message: "Something was wrong",
      details: { fields: [{ field: "name", message: "Must not be empty" }] },
      requestId: "req-1",
    });
    expect(error.status).toBe(422);
    expect(error.code).toBe("rule_violation");
    expect(error.message).toBe("Something was wrong");
    expect(error.requestId).toBe("req-1");
  });

  it("fieldErrors maps a 400's field list into field -> message", () => {
    const error = new ApiError(400, {
      code: "bad_request",
      message: "The request did not pass validation",
      details: {
        fields: [
          { field: "name", message: "Must not be empty" },
          { field: "town", message: "Must be a string" },
        ],
      },
    });
    expect(error.fieldErrors).toEqual({
      name: "Must not be empty",
      town: "Must be a string",
    });
  });

  it("fieldErrors is an empty object when there are no field details", () => {
    const error = new ApiError(500, { code: "internal", message: "Something broke" });
    expect(error.fieldErrors).toEqual({});
  });
});

describe("request", () => {
  it("sends no Authorization header when there is no session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await request("GET", "/premises");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("attaches a Bearer token from the current session", async () => {
    setSession({ accessToken: "abc123", user });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await request("GET", "/premises");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer abc123");
  });

  it("builds the URL under /api, with query parameters attached and undefined ones dropped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await request("GET", "/premises", undefined, {
      query: { limit: 10, q: "glasgow", offset: undefined },
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/premises?limit=10&q=glasgow");
  });

  it("sends a JSON body and Content-Type only when a body is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await request("POST", "/premises", { name: "Test" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Test" }));
  });

  it("returns undefined for a 204 with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request("DELETE", "/premises/1");
    expect(result).toBeUndefined();
  });

  it("throws an ApiError built from the response body on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Record not found" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("GET", "/premises/999")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "Record not found",
    });
  });

  it("falls back to a generic error when a failure carries no JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("GET", "/premises")).rejects.toMatchObject({
      status: 500,
      code: "unknown",
    });
  });

  it("on a 401, refreshes once and retries the original request", async () => {
    const fetchMock = vi.fn();
    // 1st call: the original request, refused.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthorised", message: "Expired" } }));
    // 2nd call: the refresh, which succeeds.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: { accessToken: "new-token", user } }),
    );
    // 3rd call: the retried original request, now successful.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request("GET", "/premises/1");

    expect(result).toEqual({ data: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getSession()?.accessToken).toBe("new-token");
    // The retried call carries the freshly refreshed token.
    const [, retryInit] = fetchMock.mock.calls[2];
    expect(retryInit.headers.Authorization).toBe("Bearer new-token");
  });

  it("clears the session when the refresh itself fails, and still reports the original 401", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthorised", message: "Expired" } }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    setSession({ accessToken: "stale-token", user });

    await expect(request("GET", "/premises/1")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSession()).toBeNull();
  });

  it("does not attempt a refresh for an auth endpoint's own 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorised", message: "Bad credentials" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request("POST", "/auth/login", { email: "x", password: "y" }, { isAuthEndpoint: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tryRefresh", () => {
  it("shares one in-flight request across concurrent callers", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = tryRefresh();
    const second = tryRefresh();
    resolveFetch(jsonResponse(200, { data: { accessToken: "shared-token", user } }));

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when the refresh call rejects outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await tryRefresh()).toBe(false);
  });
});
