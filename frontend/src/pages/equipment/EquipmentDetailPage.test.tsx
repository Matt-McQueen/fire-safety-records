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

const EquipmentDetailPage = (await import("./EquipmentDetailPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage(path = "/equipment/1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
          <Route path="/equipment" element={<p>Equipment list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const equipment = {
  id: 1,
  equipment_type: "extinguisher",
  location: "Kitchen",
  identifier: "EXT-01",
  in_service: true,
  has_unresolved_defect: false,
  check_overdue: false,
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

describe("EquipmentDetailPage", () => {
  it("shows a 404 page when the equipment does not exist", async () => {
    mockUser = asUser("viewer");
    getResource.mockRejectedValue(new Error("not found"));
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("shows the equipment's details, badges and check history", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: { ...equipment, has_unresolved_defect: true, check_overdue: true } });
    listResource.mockResolvedValue({
      data: [
        { id: 1, performed_on: "2026-01-01", check_type: "visual", outcome: "pass", defect_outstanding: false },
      ],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());
    expect(screen.getByText("Defect outstanding")).toBeInTheDocument();
    expect(screen.getByText("Check overdue")).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it("shows no-history message when there are no checks", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: equipment });
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(screen.getByText("No checks recorded yet.")).toBeInTheDocument());
  });

  it("editing sends only the fields that changed, and Edit is hidden below assessor", async () => {
    getResource.mockResolvedValue({ data: equipment });
    listResource.mockResolvedValue({ data: [], page: {} });
    updateResource.mockResolvedValue({ data: { id: 1 } });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("assessor");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const locationInput = screen.getByLabelText(/Location/);
    await userEvent.clear(locationInput);
    await userEvent.type(locationInput, "Plant room");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateResource).toHaveBeenCalledWith("/equipment", 1, { location: "Plant room" }));
  });

  it("only a manager or above may delete, and only after confirmation", async () => {
    getResource.mockResolvedValue({ data: equipment });
    listResource.mockResolvedValue({ data: [], page: {} });
    removeResource.mockResolvedValue(undefined);

    mockUser = asUser("assessor");
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("manager");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removeResource).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/equipment", 1));
    await waitFor(() => expect(screen.getByText("Equipment list page")).toBeInTheDocument());
  });

  it("recording a check is only offered while in service, to an assessor or above", async () => {
    getResource.mockResolvedValue({ data: { ...equipment, in_service: false } });
    listResource.mockResolvedValue({ data: [], page: {} });
    mockUser = asUser("assessor");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Record a check/ })).not.toBeInTheDocument();
  });

  it("adding a check submits against this equipment and refreshes the history", async () => {
    getResource.mockResolvedValue({ data: equipment });
    listResource.mockResolvedValue({ data: [], page: {} });
    createResource.mockResolvedValue({ data: { id: 5 } });
    mockUser = asUser("assessor");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "EXT-01" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record a check/ }));
    await userEvent.type(screen.getByLabelText(/Check type/), "visual");
    await userEvent.type(screen.getByLabelText(/Performed on/), "2026-02-01");
    await userEvent.selectOptions(screen.getByLabelText(/Outcome/), "pass");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/equipment-checks",
        expect.objectContaining({ equipment_id: 1, check_type: "visual", outcome: "pass" }),
      ),
    );
  });
});
