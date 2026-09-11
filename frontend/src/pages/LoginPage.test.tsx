import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InitialEntry } from "react-router-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/http";

const login = vi.hoisted(() => vi.fn());
vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ login }) }));

const LoginPage = (await import("./LoginPage")).default;

afterEach(() => {
  login.mockReset();
});

function renderPage(initialEntries: InitialEntry[] = ["/login"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Dashboard</p>} />
        <Route path="/premises" element={<p>Premises page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("submits the entered email and password", async () => {
    login.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/Email/), "jsmith@example.test");
    await userEvent.type(screen.getByLabelText(/Password/), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("jsmith@example.test", "correct-horse-battery-staple"),
    );
  });

  it("navigates to the dashboard after a successful sign-in", async () => {
    login.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/Email/), "a@b.com");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument());
  });

  it("returns to the page the user was on before being redirected to sign in", async () => {
    login.mockResolvedValue(undefined);
    renderPage([{ pathname: "/login", state: { from: "/premises" } }]);

    await userEvent.type(screen.getByLabelText(/Email/), "a@b.com");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Premises page")).toBeInTheDocument());
  });

  it("shows the API's own message on a refused sign-in, without navigating away", async () => {
    login.mockRejectedValue(new ApiError(401, { code: "unauthorised", message: "Email or password is not recognised" }));
    renderPage();

    await userEvent.type(screen.getByLabelText(/Email/), "a@b.com");
    await userEvent.type(screen.getByLabelText(/Password/), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByText("Email or password is not recognised")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("shows a generic message for a failure that is not an ApiError", async () => {
    login.mockRejectedValue(new Error("network down"));
    renderPage();

    await userEvent.type(screen.getByLabelText(/Email/), "a@b.com");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());
  });

  it("disables the submit button while signing in", async () => {
    let resolveLogin: () => void = () => {};
    login.mockReturnValue(new Promise<void>((resolve) => { resolveLogin = resolve; }));
    renderPage();

    await userEvent.type(screen.getByLabelText(/Email/), "a@b.com");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    resolveLogin();
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument());
  });
});
