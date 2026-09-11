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

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const EquipmentListPage = (await import("./EquipmentListPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EquipmentListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listResource.mockReset();
  mockUser = null;
  mockSelectedId = null;
});

describe("EquipmentListPage", () => {
  it("lists equipment, scoped to the globally selected premises", async () => {
    mockUser = asUser("viewer");
    mockSelectedId = 5;
    listResource.mockResolvedValue({
      data: [{ id: 1, equipment_type: "extinguisher", location: "Reception", in_service: true }],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Reception")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/equipment", {
      limit: 100,
      sort: "location",
      premises_id: "5",
      equipment_type: undefined,
    });
  });

  it("only an assessor or above may create equipment", async () => {
    listResource.mockResolvedValue({ data: [], page: {} });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /New equipment/ })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("assessor");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New equipment/ })).toBeInTheDocument());
  });

  it("filtering by type re-queries", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByRole("combobox"), "extinguisher");

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith(
        "/equipment",
        expect.objectContaining({ equipment_type: "extinguisher" }),
      ),
    );
  });
});
