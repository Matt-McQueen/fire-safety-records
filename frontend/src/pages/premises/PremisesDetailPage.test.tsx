import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const getResource = vi.hoisted(() => vi.fn());
const fetchCompliance = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ getResource, fetchCompliance }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const PremisesDetailPage = (await import("./PremisesDetailPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/premises/3"]}>
        <Routes>
          <Route path="/premises/:id" element={<PremisesDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const premises = {
  id: 3,
  name: "Main Site",
  address_line1: "1 High Street",
  town: "Glasgow",
  postcode: "G1 1AA",
  employee_count: 20,
  requires_licence: false,
  is_multi_occupancy: false,
  trigger_five_or_more_employees: true,
  trigger_licensed_premises: false,
  trigger_alterations_notice: false,
  recording_duty_applies: true,
  notes: "Key holder details with the fire warden.",
};

afterEach(() => {
  getResource.mockReset();
  fetchCompliance.mockReset();
  mockUser = null;
});

describe("PremisesDetailPage", () => {
  it("shows a 404 page for a premises that does not exist", async () => {
    mockUser = asUser("viewer");
    getResource.mockRejectedValue(new Error("not found"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("shows the overview with its triggers and recording-duty status by default", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: premises });
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Main Site" })).toBeInTheDocument());
    expect(screen.getByText("5+ employees")).toBeInTheDocument();
    expect(screen.getByText("Duty to record applies")).toBeInTheDocument();
    expect(screen.getByText("Key holder details with the fire warden.")).toBeInTheDocument();
    expect(fetchCompliance).not.toHaveBeenCalled();
  });

  it("only offers Edit to a manager or above", async () => {
    getResource.mockResolvedValue({ data: premises });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Main Site" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("manager");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
  });

  it("only loads the compliance position once that tab is opened", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: premises });
    fetchCompliance.mockResolvedValue({
      data: { checks: [{ key: "training", provision: "reg 20", status: "ok", summary: "All trained" }] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Main Site" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Compliance" }));

    expect(fetchCompliance).toHaveBeenCalledWith(3);
    await waitFor(() => expect(screen.getByText("All trained")).toBeInTheDocument());
  });

  it("the records tab links to every premises-scoped resource, including the bespoke ones", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: premises });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Main Site" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Records" }));

    expect(screen.getByRole("link", { name: /Equipment/ })).toHaveAttribute(
      "href",
      "/equipment?premises_id=3",
    );
    expect(screen.getByRole("link", { name: /Escape routes/ })).toHaveAttribute(
      "href",
      "/escape-routes?premises_id=3",
    );
    // At least one generic premises-scoped resource should be linked too.
    expect(screen.getByRole("link", { name: /Safety roles/ })).toHaveAttribute(
      "href",
      "/records/safety_roles?premises_id=3",
    );
  });
});
