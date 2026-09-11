import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../types/api";

const changePassword = vi.hoisted(() => vi.fn());
vi.mock("../lib/authService", () => ({ changePassword }));

let mockUser: SessionUser | null = {
  id: 1,
  email: "jsmith@example.test",
  fullName: "J Smith",
  role: "viewer",
  personId: null,
  premisesIds: [],
};
vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const AccountPage = (await import("./AccountPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  changePassword.mockReset();
});

describe("AccountPage", () => {
  it("shows who is signed in", () => {
    renderPage();
    expect(screen.getByText(/jsmith@example.test/)).toBeInTheDocument();
  });

  it("submits the current and new password", async () => {
    changePassword.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/Current password/), "old-password-value");
    await userEvent.type(screen.getByLabelText(/New password/), "a-new-long-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith("old-password-value", "a-new-long-passphrase"),
    );
  });

  it("shows a confirmation and a way to sign in again once changed", async () => {
    changePassword.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/Current password/), "old-password-value");
    await userEvent.type(screen.getByLabelText(/New password/), "a-new-long-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(screen.getByText("Password changed")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("shows the server's rejection and stays on the form", async () => {
    changePassword.mockRejectedValue(new Error("Current password is not recognised"));
    renderPage();

    await userEvent.type(screen.getByLabelText(/Current password/), "wrong-password-value");
    await userEvent.type(screen.getByLabelText(/New password/), "a-new-long-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(screen.getByText("Current password is not recognised")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Password changed")).not.toBeInTheDocument();
  });
});
