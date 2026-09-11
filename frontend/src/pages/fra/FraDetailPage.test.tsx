import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const fetchFullAssessment = vi.hoisted(() => vi.fn());
const getResource = vi.hoisted(() => vi.fn());
const publishAssessment = vi.hoisted(() => vi.fn());
const removeResource = vi.hoisted(() => vi.fn());
const updateResource = vi.hoisted(() => vi.fn());
const createResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({
  fetchFullAssessment,
  getResource,
  publishAssessment,
  removeResource,
  updateResource,
  createResource,
}));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const confirmSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("confirm", confirmSpy);

const FraDetailPage = (await import("./FraDetailPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage(path = "/fire-risk-assessments/1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/fire-risk-assessments/:id" element={<FraDetailPage />} />
          <Route path="/fire-risk-assessments" element={<p>FRA list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fullAssessment(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 1,
      reference: null,
      premises_id: 3,
      premises_name: "Main Site",
      status: "draft",
      assessment_type: "initial",
      carried_out_on: "2026-01-01",
      recorded_on: null,
      next_review_due: null,
      carried_out_by_id: null,
      assessor_external: "Competent Assessors Ltd",
      assessor_competence: null,
      covers_young_persons: false,
      covers_dangerous_substances: false,
      summary: null,
      review_overdue: false,
      significant_findings: [],
      persons_at_risk: [],
      ...overrides,
    },
  };
}

afterEach(() => {
  fetchFullAssessment.mockReset();
  getResource.mockReset();
  publishAssessment.mockReset();
  removeResource.mockReset();
  updateResource.mockReset();
  createResource.mockReset();
  confirmSpy.mockReset();
  mockUser = null;
});

describe("FraDetailPage — states", () => {
  it("shows the fetch failure inline rather than a 404 page, since a failed request is not the same as a confirmed-missing record", async () => {
    mockUser = asUser("viewer");
    fetchFullAssessment.mockRejectedValue(new Error("not found"));
    renderPage();
    await waitFor(() => expect(screen.getByText("not found")).toBeInTheDocument());
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });

  it("shows the API error inline when the request fails with a real error", async () => {
    mockUser = asUser("viewer");
    const { ApiError } = await import("../../lib/http");
    fetchFullAssessment.mockRejectedValue(new ApiError(500, { code: "internal_error", message: "Server error" }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });

  it("shows a draft's status, and offers Edit, Publish and Delete to a manager", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    renderPage();

    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete draft" })).toBeInTheDocument();
  });

  it("an assessor may edit a draft but not publish or delete it", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    renderPage();

    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("a current assessment past its review date is flagged, and cannot be published or deleted again", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment({ status: "current", review_overdue: true }));
    renderPage();

    await waitFor(() => expect(screen.getByText("Current — review overdue")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("a superseded assessment cannot be edited even by a manager", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment({ status: "superseded" }));
    renderPage();

    await waitFor(() => expect(screen.getByText("Superseded")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("FraDetailPage — editing and publishing", () => {
  it("editing a draft sends only the changed fields", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    updateResource.mockResolvedValue({ data: { id: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText(/Assessor competence/), "NEBOSH certificate");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateResource).toHaveBeenCalledWith("/fire-risk-assessments", 1, {
        assessor_competence: "NEBOSH certificate",
      }),
    );
  });

  it("a current assessment can only have its review date and summary edited", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment({ status: "current", recorded_on: "2026-01-05" }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Current")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(/Next review due/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Assessor competence/)).not.toBeInTheDocument();
  });

  it("publishing confirms and calls the publish endpoint", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    publishAssessment.mockResolvedValue({ data: { id: 1, status: "current" } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm publish" }));

    await waitFor(() =>
      expect(publishAssessment).toHaveBeenCalledWith(1, { recorded_on: undefined, assessment_type: "review" }),
    );
  });

  it("deleting a draft asks for confirmation before removing it", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    removeResource.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(removeResource).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/fire-risk-assessments", 1));
    await waitFor(() => expect(screen.getByText("FRA list page")).toBeInTheDocument());
  });
});

describe("FraDetailPage — findings, measures and persons at risk", () => {
  it("shows the empty-state messages when nothing is recorded", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("No significant findings recorded yet.")).toBeInTheDocument(),
    );
    expect(screen.getByText("No persons at particular risk recorded.")).toBeInTheDocument();
  });

  it("adds a finding to the draft assessment", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(fullAssessment());
    createResource.mockResolvedValue({ data: { id: 9 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("No significant findings recorded yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "+ Add finding" }));
    await userEvent.type(screen.getByLabelText(/Finding/), "Fire door wedged open");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/fra-significant-findings",
        expect.objectContaining({ finding: "Fire door wedged open", fire_risk_assessment_id: 1 }),
      ),
    );
  });

  it("does not offer to add a finding once the assessment is no longer a draft", async () => {
    mockUser = asUser("manager");
    fetchFullAssessment.mockResolvedValue(fullAssessment({ status: "current" }));
    renderPage();
    await waitFor(() => expect(screen.getByText("No significant findings recorded yet.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ Add finding" })).not.toBeInTheDocument();
  });

  it("shows a finding's risk rating and lets it be edited or deleted", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(
      fullAssessment({
        significant_findings: [
          {
            id: 5,
            finding: "Combustibles near the intake",
            location: "Plant room",
            risk_rating: "High",
            measures: [],
          },
        ],
      }),
    );
    removeResource.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => expect(screen.getByText("Combustibles near the intake")).toBeInTheDocument());
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(/Plant room/)).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/fra-significant-findings", 5));
  });

  it("adds a measure to a finding, and shows an overdue planned measure as such", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(
      fullAssessment({
        significant_findings: [
          {
            id: 5,
            finding: "Combustibles near the intake",
            measures: [
              { id: 11, description: "Fit signage", status: "planned", overdue: true, target_date: "2026-01-01" },
            ],
          },
        ],
      }),
    );
    createResource.mockResolvedValue({ data: { id: 12 } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Fit signage")).toBeInTheDocument());
    expect(screen.getByText("Planned — overdue")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ Add measure" }));
    await userEvent.type(screen.getByLabelText(/Description/), "Remove combustibles");
    await userEvent.selectOptions(screen.getByLabelText(/Status/), "taken");
    await userEvent.type(screen.getByLabelText(/Completed on/), "2026-02-01");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/fra-measures",
        expect.objectContaining({ description: "Remove combustibles", finding_id: 5, status: "taken" }),
      ),
    );
  });

  it("adds a person at particular risk, showing a PEEP badge when one is in place", async () => {
    mockUser = asUser("assessor");
    fetchFullAssessment.mockResolvedValue(
      fullAssessment({
        persons_at_risk: [
          {
            id: 21,
            group_description: "Night shift cleaners",
            category: "lone_worker",
            why_at_risk: "Works alone",
            peep_in_place: true,
          },
        ],
      }),
    );
    createResource.mockResolvedValue({ data: { id: 22 } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Night shift cleaners")).toBeInTheDocument());
    expect(screen.getByText("PEEP in place")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ Add person or group" }));
    await userEvent.type(screen.getByLabelText(/Group description/), "Visitors");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/fra-persons-at-risk",
        expect.objectContaining({ group_description: "Visitors", fire_risk_assessment_id: 1 }),
      ),
    );
  });
});
