import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const FraListPage = (await import("./FraListPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FraListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listResource.mockReset();
  mockUser = null;
  mockSelectedId = null;
});

describe("FraListPage", () => {
  it("lists assessments, scoped to the globally selected premises", async () => {
    mockUser = asUser("viewer");
    mockSelectedId = 5;
    listResource.mockResolvedValue({
      data: [{ id: 1, premises_name: "Main Site", status: "current", carried_out_on: "2026-01-01" }],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Main Site")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/fire-risk-assessments", {
      limit: 100,
      sort: "carried_out_on",
      order: "desc",
      premises_id: "5",
      status: undefined,
    });
  });

  it("only an assessor or above may create a new assessment", async () => {
    listResource.mockResolvedValue({ data: [], page: {} });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /New assessment/ })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("assessor");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New assessment/ })).toBeInTheDocument());
  });

  it("filtering by status re-queries", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    const statusSelect = within(screen.getByText("Status").parentElement!).getByRole("combobox");
    await userEvent.selectOptions(statusSelect, "draft");

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith(
        "/fire-risk-assessments",
        expect.objectContaining({ status: "draft" }),
      ),
    );
  });
});
