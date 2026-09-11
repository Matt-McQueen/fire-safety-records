import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const getResource = vi.hoisted(() => vi.fn());
const listResource = vi.hoisted(() => vi.fn());
const removeResource = vi.hoisted(() => vi.fn());
const updateResource = vi.hoisted(() => vi.fn());
const createResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ getResource, listResource, removeResource, updateResource, createResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const confirmSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("confirm", confirmSpy);

const EscapeRouteDetailPage = (await import("./EscapeRouteDetailPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage(path = "/escape-routes/1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/escape-routes/:id" element={<EscapeRouteDetailPage />} />
          <Route path="/escape-routes" element={<p>Escape route list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const route = {
  id: 1,
  name: "Stair 2",
  final_exit: "Rear yard",
  in_service: true,
  has_unresolved_obstruction: false,
  check_overdue: false,
  has_emergency_lighting: true,
};

afterEach(() => {
  getResource.mockReset();
  listResource.mockReset();
  removeResource.mockReset();
  updateResource.mockReset();
  createResource.mockReset();
  confirmSpy.mockReset();
  mockUser = null;
});

describe("EscapeRouteDetailPage", () => {
  it("shows a 404 page when the route does not exist", async () => {
    mockUser = asUser("viewer");
    getResource.mockRejectedValue(new Error("not found"));
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("shows the route's details, badges and check history", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: { ...route, has_unresolved_obstruction: true, check_overdue: true } });
    listResource.mockResolvedValue({
      data: [{ id: 1, performed_on: "2026-01-01", outcome: "pass", obstruction_outstanding: false }],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Stair 2" })).toBeInTheDocument());
    expect(screen.getByText("Obstruction outstanding")).toBeInTheDocument();
    expect(screen.getByText("Check overdue")).toBeInTheDocument();
    expect(screen.getByText("Emergency lighting")).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it("editing sends only the fields that changed", async () => {
    mockUser = asUser("assessor");
    getResource.mockResolvedValue({ data: route });
    listResource.mockResolvedValue({ data: [], page: {} });
    updateResource.mockResolvedValue({ data: { id: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Stair 2" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText(/Name/);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Stair 3");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateResource).toHaveBeenCalledWith("/escape-routes", 1, { name: "Stair 3" }));
  });

  it("only a manager or above may delete, and only after confirmation", async () => {
    mockUser = asUser("manager");
    getResource.mockResolvedValue({ data: route });
    listResource.mockResolvedValue({ data: [], page: {} });
    removeResource.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Stair 2" })).toBeInTheDocument());

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removeResource).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/escape-routes", 1));
    await waitFor(() => expect(screen.getByText("Escape route list page")).toBeInTheDocument());
  });

  it("recording a check is only offered while in service", async () => {
    mockUser = asUser("assessor");
    getResource.mockResolvedValue({ data: { ...route, in_service: false } });
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Stair 2" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Record a check/ })).not.toBeInTheDocument();
  });

  it("adding a check submits against this route", async () => {
    mockUser = asUser("assessor");
    getResource.mockResolvedValue({ data: route });
    listResource.mockResolvedValue({ data: [], page: {} });
    createResource.mockResolvedValue({ data: { id: 5 } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Stair 2" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record a check/ }));
    await userEvent.type(screen.getByLabelText(/Performed on/), "2026-02-01");
    await userEvent.selectOptions(screen.getByLabelText(/Outcome/), "pass");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/escape-route-checks",
        expect.objectContaining({ escape_route_id: 1, outcome: "pass" }),
      ),
    );
  });
});
