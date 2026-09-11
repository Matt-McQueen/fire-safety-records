import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser } from "../types/api";

const tryRefresh = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ tryRefresh }));

const authServiceLogin = vi.hoisted(() => vi.fn());
const authServiceLogout = vi.hoisted(() => vi.fn());
vi.mock("./authService", () => ({ login: authServiceLogin, logout: authServiceLogout }));

const { AuthProvider, useAuth } = await import("./AuthContext");
const { clearSession, setSession } = await import("./session");

const user: SessionUser = {
  id: 1,
  email: "manager@example.test",
  fullName: "M Anager",
  role: "manager",
  personId: null,
  premisesIds: [],
};

function Consumer() {
  const { user, booting, login, logout, hasRole } = useAuth();
  return (
    <div>
      <p data-testid="booting">{String(booting)}</p>
      <p data-testid="user">{user?.email ?? "none"}</p>
      <p data-testid="can-admin">{String(hasRole("admin"))}</p>
      <p data-testid="can-viewer">{String(hasRole("viewer"))}</p>
      <button onClick={() => login("a@b.com", "pw")}>Log in</button>
      <button onClick={() => logout()}>Log out</button>
    </div>
  );
}

afterEach(() => {
  clearSession();
  tryRefresh.mockReset();
  authServiceLogin.mockReset();
  authServiceLogout.mockReset();
});

describe("AuthProvider", () => {
  it("boots by attempting a silent refresh, and stops booting once it settles", async () => {
    tryRefresh.mockResolvedValue(false);
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("booting")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("booting")).toHaveTextContent("false"));
    expect(tryRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("reflects a session already established by the silent refresh", async () => {
    tryRefresh.mockImplementation(async () => {
      setSession({ accessToken: "tok", user });
      return true;
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("manager@example.test"));
  });

  it("login delegates to authService.login, and the session update is reflected", async () => {
    tryRefresh.mockResolvedValue(false);
    authServiceLogin.mockImplementation(async () => {
      setSession({ accessToken: "tok", user });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("booting")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("Log in"));

    expect(authServiceLogin).toHaveBeenCalledWith("a@b.com", "pw");
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("manager@example.test"));
  });

  it("logout delegates to authService.logout, and clearing the session is reflected", async () => {
    tryRefresh.mockImplementation(async () => {
      setSession({ accessToken: "tok", user });
      return true;
    });
    authServiceLogout.mockImplementation(async () => {
      clearSession();
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("manager@example.test"));

    await userEvent.click(screen.getByText("Log out"));

    expect(authServiceLogout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
  });

  it("hasRole ranks a manager above viewer but below admin", async () => {
    tryRefresh.mockImplementation(async () => {
      setSession({ accessToken: "tok", user });
      return true;
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("can-viewer")).toHaveTextContent("true"));
    expect(screen.getByTestId("can-admin")).toHaveTextContent("false");
  });

  it("hasRole is false for every role when signed out", async () => {
    tryRefresh.mockResolvedValue(false);
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("booting")).toHaveTextContent("false"));
    expect(screen.getByTestId("can-viewer")).toHaveTextContent("false");
  });

  it("useAuth throws when used outside an AuthProvider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/useAuth must be used within AuthProvider/);
    consoleSpy.mockRestore();
  });
});
