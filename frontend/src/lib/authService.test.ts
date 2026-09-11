import { afterEach, describe, expect, it, vi } from "vitest";
import { changePassword, login, logout, logoutEverywhere } from "./authService";
import { clearSession, getSession, setSession } from "./session";
import type { SessionUser } from "../types/api";

const request = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ request }));

const user: SessionUser = {
  id: 1,
  email: "jsmith@example.test",
  fullName: "J Smith",
  role: "viewer",
  personId: null,
  premisesIds: [],
};

afterEach(() => {
  clearSession();
  request.mockReset();
});

describe("login", () => {
  it("stores the returned access token and user, and returns the user", async () => {
    request.mockResolvedValue({ data: { accessToken: "tok-1", expiresIn: "15m", user } });

    const result = await login("jsmith@example.test", "correct-horse-battery-staple");

    expect(result).toEqual(user);
    expect(getSession()).toEqual({ accessToken: "tok-1", user });
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/auth/login",
      { email: "jsmith@example.test", password: "correct-horse-battery-staple" },
      { isAuthEndpoint: true },
    );
  });

  it("leaves no session behind when the request fails", async () => {
    request.mockRejectedValue(new Error("invalid credentials"));

    await expect(login("jsmith@example.test", "wrong")).rejects.toThrow();
    expect(getSession()).toBeNull();
  });
});

describe("logout", () => {
  it("clears the session once the server confirms", async () => {
    setSession({ accessToken: "tok-1", user });
    request.mockResolvedValue(undefined);

    await logout();

    expect(getSession()).toBeNull();
    expect(request).toHaveBeenCalledWith("POST", "/auth/logout", undefined, { isAuthEndpoint: true });
  });

  it("still clears the local session even if the server call fails", async () => {
    setSession({ accessToken: "tok-1", user });
    request.mockRejectedValue(new Error("network error"));

    await expect(logout()).rejects.toThrow();
    expect(getSession()).toBeNull();
  });
});

describe("changePassword", () => {
  it("sends both passwords and clears the session on success, since every session is closed server-side", async () => {
    setSession({ accessToken: "tok-1", user });
    request.mockResolvedValue(undefined);

    await changePassword("old-pass-phrase", "new-pass-phrase");

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/auth/change-password",
      { currentPassword: "old-pass-phrase", newPassword: "new-pass-phrase" },
      { isAuthEndpoint: true },
    );
    expect(getSession()).toBeNull();
  });

  it("does not clear the session when the change is refused", async () => {
    setSession({ accessToken: "tok-1", user });
    request.mockRejectedValue(new Error("wrong current password"));

    await expect(changePassword("wrong", "new-pass-phrase")).rejects.toThrow();
    expect(getSession()).toEqual({ accessToken: "tok-1", user });
  });
});

describe("logoutEverywhere", () => {
  it("clears the local session after asking the server to revoke every session", async () => {
    setSession({ accessToken: "tok-1", user });
    request.mockResolvedValue(undefined);

    await logoutEverywhere();

    expect(request).toHaveBeenCalledWith("POST", "/auth/logout-all", undefined, { isAuthEndpoint: true });
    expect(getSession()).toBeNull();
  });
});
