import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Row, SessionUser } from "../types/api";

const fetchCompliance = vi.hoisted(() => vi.fn());
const fetchComplianceSummary = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ fetchCompliance, fetchComplianceSummary }));

let mockUser: SessionUser | null = {
  id: 1,
  email: "a@b.com",
  fullName: "Jordan Reid",
  role: "viewer",
  personId: null,
  premisesIds: [],
};
vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockPremisesState: {
  premises: Row[];
  isLoading: boolean;
  selectedId: number | null;
  selected: Row | null;
} = { premises: [], isLoading: true, selectedId: null, selected: null };
vi.mock("../lib/PremisesContext", () => ({ usePremises: () => mockPremisesState }));

const DashboardPage = (await import("./DashboardPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function complianceResult(summary: { ok: number; attention: number; missing: number }, name = "A Premises") {
  return {
    data: {
      premises: { id: 1, name, employee_count: 10 },
      recording_duty_applies: true,
      generated_at: new Date().toISOString(),
      summary: { not_required: 0, ...summary },
      checks: [{ key: "training", provision: "reg 20", status: "ok", summary: "All trained" }],
      caveat: "…",
    },
  };
}

afterEach(() => {
  fetchCompliance.mockReset();
  fetchComplianceSummary.mockReset();
  mockPremisesState = { premises: [], isLoading: true, selectedId: null, selected: null };
});

describe("DashboardPage", () => {
  it("greets the signed-in user", () => {
    mockPremisesState = { premises: [], isLoading: false, selectedId: null, selected: null };
    renderPage();
    expect(screen.getByText("Welcome, Jordan Reid")).toBeInTheDocument();
  });

  it("shows a spinner while the premises list is loading", () => {
    mockPremisesState = { premises: [], isLoading: true, selectedId: null, selected: null };
    renderPage();
    expect(screen.getByText("Loading premises…")).toBeInTheDocument();
  });

  it("tells an account with no premises granted to ask an administrator", () => {
    mockPremisesState = { premises: [], isLoading: false, selectedId: null, selected: null };
    renderPage();
    expect(screen.getByText(/has not been granted access to any premises/)).toBeInTheDocument();
  });

  it("shows the single selected premises' compliance position", async () => {
    mockPremisesState = {
      premises: [{ id: 1, name: "Main Site" }],
      isLoading: false,
      selectedId: 1,
      selected: { id: 1, name: "Main Site" },
    };
    fetchCompliance.mockResolvedValue(complianceResult({ ok: 5, attention: 1, missing: 2 }, "Main Site"));
    renderPage();

    expect(screen.getByRole("heading", { name: "Main Site" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("All trained")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(fetchCompliance).toHaveBeenCalledWith(1);
  });

  it("shows a grid of every premises when none is individually selected", async () => {
    mockPremisesState = {
      premises: [
        { id: 1, name: "Site One" },
        { id: 2, name: "Site Two" },
      ],
      isLoading: false,
      selectedId: null,
      selected: null,
    };
    // A single batched call, not one fetchCompliance per premises - see
    // DashboardPage.tsx's PremisesGrid for why.
    fetchComplianceSummary.mockResolvedValue({
      data: [
        complianceResult({ ok: 5, attention: 0, missing: 0 }, "Site One").data,
        complianceResult({ ok: 3, attention: 2, missing: 0 }, "Site Two").data,
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("All OK")).toBeInTheDocument());
    expect(screen.getByText("2 need attention")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Site One/ })).toHaveAttribute("href", "/premises/1");
    expect(fetchCompliance).not.toHaveBeenCalled();
  });
});
