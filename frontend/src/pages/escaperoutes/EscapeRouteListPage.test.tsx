import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const EscapeRouteListPage = (await import("./EscapeRouteListPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EscapeRouteListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listResource.mockReset();
  mockUser = null;
  mockSelectedId = null;
});

describe("EscapeRouteListPage", () => {
  it("lists escape routes, scoped to the globally selected premises", async () => {
    mockUser = asUser("viewer");
    mockSelectedId = 5;
    listResource.mockResolvedValue({ data: [{ id: 1, name: "Stair 2", in_service: true }], page: {} });
    renderPage();

    await waitFor(() => expect(screen.getByText("Stair 2")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/escape-routes", { limit: 100, sort: "name", premises_id: "5" });
    expect(screen.getByRole("link", { name: /Stair 2/ })).toHaveAttribute("href", "/escape-routes/1");
  });

  it("only a manager or above may create an escape route", async () => {
    listResource.mockResolvedValue({ data: [], page: {} });

    mockUser = asUser("assessor");
    const { unmount } = renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /New escape route/ })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("manager");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New escape route/ })).toBeInTheDocument());
  });

  it("shows the API error instead of the table on failure", async () => {
    mockUser = asUser("viewer");
    listResource.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
