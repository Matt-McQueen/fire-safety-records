import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const createUser = vi.hoisted(() => vi.fn());
const deactivateUser = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const listResource = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ createUser, deactivateUser, getUser, listResource, updateUser }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const confirmSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("confirm", confirmSpy);

const UserFormPage = (await import("./UserFormPage")).default;

function asUser(id: number, role: SessionUser["role"]): SessionUser {
  return { id, email: "admin@example.test", fullName: "Admin", role, personId: null, premisesIds: null };
}

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/users/new" element={<UserFormPage />} />
          <Route path="/admin/users/:id" element={<UserFormPage />} />
          <Route path="/admin/users" element={<p>Users list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  createUser.mockReset();
  deactivateUser.mockReset();
  getUser.mockReset();
  listResource.mockReset();
  updateUser.mockReset();
  confirmSpy.mockReset();
  mockUser = null;
});

describe("UserFormPage — creating", () => {
  it("creates a user with the premises checked", async () => {
    mockUser = asUser(1, "admin");
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Main Site" }], page: {} });
    createUser.mockResolvedValue({ data: { id: 9 } });
    renderPage("/admin/users/new");

    await userEvent.type(screen.getByLabelText(/Email/), "new@example.test");
    await userEvent.type(screen.getByLabelText(/Full name/), "New Person");
    await userEvent.type(screen.getByLabelText(/Initial password/), "correct-horse-battery-staple");
    await waitFor(() => expect(screen.getByLabelText("Main Site")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Main Site"));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        email: "new@example.test",
        full_name: "New Person",
        password: "correct-horse-battery-staple",
        role: "viewer",
        premises_ids: [5],
      }),
    );
    await waitFor(() => expect(screen.getByText("Users list page")).toBeInTheDocument());
  });

  it("hides the premises picker for an admin account", async () => {
    mockUser = asUser(1, "admin");
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Main Site" }], page: {} });
    renderPage("/admin/users/new");

    await userEvent.selectOptions(screen.getByLabelText(/Role/), "admin");
    expect(screen.getByText(/reaches every premises/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Main Site")).not.toBeInTheDocument();
  });

  it("shows the server's field errors on failure", async () => {
    mockUser = asUser(1, "admin");
    listResource.mockResolvedValue({ data: [], page: {} });
    const { ApiError } = await import("../../lib/http");
    createUser.mockRejectedValue(
      new ApiError(400, {
        code: "bad_request",
        message: "The request did not pass validation",
        details: { fields: [{ field: "password", message: "Must be at least 12 characters" }] },
      }),
    );
    renderPage("/admin/users/new");

    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByText("Must be at least 12 characters")).toBeInTheDocument());
  });
});

describe("UserFormPage — editing", () => {
  const existing = {
    id: 2,
    email: "manager@example.test",
    full_name: "Manager Account",
    role: "manager",
    is_active: true,
    locked_until: null,
    premises_ids: [5],
  };

  it("loads the account, with the email fixed", async () => {
    mockUser = asUser(1, "admin");
    getUser.mockResolvedValue({ data: existing });
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Main Site" }], page: {} });
    renderPage("/admin/users/2");

    await waitFor(() => expect(screen.getByDisplayValue("manager@example.test")).toBeDisabled());
    await waitFor(() => expect(screen.getByLabelText("Main Site")).toBeChecked());
  });

  it("shows a 404 page for an account that does not exist", async () => {
    mockUser = asUser(1, "admin");
    getUser.mockRejectedValue(new Error("not found"));
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage("/admin/users/999");
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("saves the updated role, status and premises", async () => {
    mockUser = asUser(1, "admin");
    getUser.mockResolvedValue({ data: existing });
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Main Site" }], page: {} });
    updateUser.mockResolvedValue({ data: existing });
    renderPage("/admin/users/2");

    await waitFor(() => expect(screen.getByLabelText("Main Site")).toBeChecked());
    await userEvent.click(screen.getByLabelText("Active"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(2, {
        full_name: "Manager Account",
        role: "manager",
        is_active: false,
        premises_ids: [5],
      }),
    );
  });

  it("an account cannot deactivate itself, or demote itself away from admin", async () => {
    mockUser = asUser(2, "admin");
    getUser.mockResolvedValue({ data: { ...existing, id: 2, role: "admin" } });
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage("/admin/users/2");

    await waitFor(() => expect(screen.getByLabelText(/Role/)).toBeDisabled());
    expect(screen.getByLabelText("Active")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("deactivates another account after confirmation", async () => {
    mockUser = asUser(1, "admin");
    getUser.mockResolvedValue({ data: existing });
    listResource.mockResolvedValue({ data: [], page: {} });
    deactivateUser.mockResolvedValue({ data: existing });
    renderPage("/admin/users/2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument());

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(deactivateUser).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(deactivateUser).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.getByText("Users list page")).toBeInTheDocument());
  });

  it("offers to clear a lockout only when the account is currently locked", async () => {
    mockUser = asUser(1, "admin");
    listResource.mockResolvedValue({ data: [], page: {} });

    getUser.mockResolvedValue({ data: existing });
    const { unmount } = renderPage("/admin/users/2");
    await waitFor(() => expect(screen.getByDisplayValue("manager@example.test")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Clear lockout" })).not.toBeInTheDocument();
    unmount();

    getUser.mockResolvedValue({
      data: { ...existing, locked_until: new Date(Date.now() + 3_600_000).toISOString() },
    });
    updateUser.mockResolvedValue({ data: existing });
    renderPage("/admin/users/2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear lockout" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Clear lockout" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(2, { unlock: true }));
  });
});
