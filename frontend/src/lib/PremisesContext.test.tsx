import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionUser } from "../types/api";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ listResource }));

let mockUser: SessionUser | null = null;
vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const { PremisesProvider, usePremises } = await import("./PremisesContext");

const premisesRows = [
  { id: 1, name: "First Premises" },
  { id: 2, name: "Second Premises" },
];

function Consumer() {
  const { premises, isLoading, selectedId, setSelectedId, selected } = usePremises();
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="count">{premises.length}</p>
      <p data-testid="selected-id">{String(selectedId)}</p>
      <p data-testid="selected-name">{selected ? String(selected.name) : "none"}</p>
      <button onClick={() => setSelectedId(2)}>Select second</button>
      <button onClick={() => setSelectedId(null)}>Clear</button>
    </div>
  );
}

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PremisesProvider>
        <Consumer />
      </PremisesProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  mockUser = null;
  listResource.mockReset();
});

describe("PremisesProvider", () => {
  it("does not query for the picker list when there is no signed-in user", async () => {
    mockUser = null;
    listResource.mockResolvedValue({ data: premisesRows, page: {} });
    renderWithClient();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(listResource).not.toHaveBeenCalled();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("loads the premises list once a user is signed in", async () => {
    mockUser = { id: 1, email: "a@b.com", fullName: "A", role: "viewer", personId: null, premisesIds: [] };
    listResource.mockResolvedValue({ data: premisesRows, page: {} });
    renderWithClient();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(listResource).toHaveBeenCalledWith("/premises", { limit: 200, sort: "name", order: "asc" });
  });

  it("starts with whatever premises id was remembered in localStorage", async () => {
    localStorage.setItem("fsr:selectedPremisesId", "2");
    mockUser = { id: 1, email: "a@b.com", fullName: "A", role: "viewer", personId: null, premisesIds: [] };
    listResource.mockResolvedValue({ data: premisesRows, page: {} });
    renderWithClient();

    await waitFor(() => expect(screen.getByTestId("selected-name")).toHaveTextContent("Second Premises"));
  });

  it("selecting a premises persists the choice, and clearing it removes the stored value", async () => {
    mockUser = { id: 1, email: "a@b.com", fullName: "A", role: "viewer", personId: null, premisesIds: [] };
    listResource.mockResolvedValue({ data: premisesRows, page: {} });
    renderWithClient();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("Select second"));
    expect(screen.getByTestId("selected-name")).toHaveTextContent("Second Premises");
    expect(localStorage.getItem("fsr:selectedPremisesId")).toBe("2");

    await userEvent.click(screen.getByText("Clear"));
    expect(screen.getByTestId("selected-name")).toHaveTextContent("none");
    expect(localStorage.getItem("fsr:selectedPremisesId")).toBeNull();
  });

  it("drops a remembered selection once the list loads and no longer contains it", async () => {
    localStorage.setItem("fsr:selectedPremisesId", "999");
    mockUser = { id: 1, email: "a@b.com", fullName: "A", role: "viewer", personId: null, premisesIds: [] };
    listResource.mockResolvedValue({ data: premisesRows, page: {} });
    renderWithClient();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    await waitFor(() => expect(screen.getByTestId("selected-id")).toHaveTextContent("null"));
  });

  it("usePremises throws when used outside a PremisesProvider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/usePremises must be used within PremisesProvider/);
    consoleSpy.mockRestore();
  });
});
