import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const PremisesListPage = (await import("./PremisesListPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PremisesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listResource.mockReset();
  mockUser = null;
});

describe("PremisesListPage", () => {
  it("lists premises with the recording-duty badge", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({
      data: [{ id: 1, name: "Main Site", town: "Glasgow", recording_duty_applies: true }],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Main Site")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/premises", { limit: 200, sort: "name", q: undefined });
    expect(screen.getByText("Applies")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Main Site/ })).toHaveAttribute("href", "/premises/1");
  });

  it("only a manager or above sees the create button", async () => {
    listResource.mockResolvedValue({ data: [], page: {} });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /New premises/ })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("manager");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New premises/ })).toBeInTheDocument());
  });

  it("typing in the search box re-queries with the term", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText("Search premises…"), "Glasgow");
    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith("/premises", { limit: 200, sort: "name", q: "Glasgow" }),
    );
  });

  it("shows the API error instead of the table on failure", async () => {
    mockUser = asUser("viewer");
    listResource.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
