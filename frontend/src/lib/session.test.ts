import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSession, getSession, setSession, subscribe } from "./session";
import type { SessionUser } from "../types/api";

const user: SessionUser = {
  id: 1,
  email: "jsmith@example.test",
  fullName: "J Smith",
  role: "viewer",
  personId: null,
  premisesIds: [],
};

afterEach(() => {
  // The store is module-level, so it outlives any one test.
  clearSession();
});

describe("getSession / setSession / clearSession", () => {
  it("has no session before one is set", () => {
    expect(getSession()).toBeNull();
  });

  it("returns exactly what was set", () => {
    setSession({ accessToken: "token-1", user });
    expect(getSession()).toEqual({ accessToken: "token-1", user });
  });

  it("clearing removes the session", () => {
    setSession({ accessToken: "token-1", user });
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("setSession overwrites a previous session rather than merging it", () => {
    setSession({ accessToken: "token-1", user });
    const other: SessionUser = { ...user, id: 2, email: "other@example.test" };
    setSession({ accessToken: "token-2", user: other });
    expect(getSession()).toEqual({ accessToken: "token-2", user: other });
  });
});

describe("subscribe", () => {
  it("notifies every listener when the session is set", () => {
    const listener = vi.fn();
    subscribe(listener);
    setSession({ accessToken: "token-1", user });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies listeners when the session is cleared", () => {
    setSession({ accessToken: "token-1", user });
    const listener = vi.fn();
    subscribe(listener);
    clearSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when clearing an already-empty session", () => {
    const listener = vi.fn();
    subscribe(listener);
    clearSession();
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();
    setSession({ accessToken: "token-1", user });
    expect(listener).not.toHaveBeenCalled();
  });
});
