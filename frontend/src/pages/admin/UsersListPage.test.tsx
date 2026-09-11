import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const listUsers = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listUsers }));

const UsersListPage = (await import("./UsersListPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listUsers.mockReset();
});

describe("UsersListPage", () => {
  it("lists accounts with their role label and status badge", async () => {
    listUsers.mockResolvedValue({
      data: [
        { id: 1, email: "manager@example.test", full_name: "M Anager", role: "manager", is_active: true, locked_until: null, premises_ids: [3] },
      ],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("manager@example.test")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Manager")).toBeInTheDocument();
    expect(table.getByText("Active")).toBeInTheDocument();
    expect(table.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /manager@example.test/ })).toHaveAttribute("href", "/admin/users/1");
  });

  it("shows an admin as reaching all premises, and a locked account as such", async () => {
    listUsers.mockResolvedValue({
      data: [
        { id: 2, email: "admin@example.test", full_name: "Admin Account", role: "admin", is_active: true, locked_until: null, premises_ids: null },
        {
          id: 3,
          email: "locked@example.test",
          full_name: "Locked-Out Account",
          role: "viewer",
          is_active: true,
          locked_until: new Date(Date.now() + 3_600_000).toISOString(),
          premises_ids: [],
        },
      ],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("admin@example.test")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("All")).toBeInTheDocument();
    expect(table.getByText("Locked")).toBeInTheDocument();
  });

  it("searching and filtering by role re-queries", async () => {
    listUsers.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText("Search…"), "reid");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith({ q: "reid", role: undefined, limit: 100 }),
    );

    await userEvent.selectOptions(screen.getByRole("combobox"), "Manager");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith({ q: "reid", role: "manager", limit: 100 }),
    );
  });

  it("shows the API error instead of the table on failure", async () => {
    listUsers.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
