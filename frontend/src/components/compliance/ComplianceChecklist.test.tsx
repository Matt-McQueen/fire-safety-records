import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComplianceChecklist } from "./ComplianceChecklist";
import type { ComplianceCheck } from "../../lib/api";

const checks: ComplianceCheck[] = [
  { key: "fire_risk_assessment", provision: "SSI 2006/456 reg 3", status: "ok", summary: "Current" },
  { key: "training", provision: "SSI 2006/456 reg 20", status: "attention", summary: "Overdue" },
  { key: "emergency_procedures", provision: "SSI 2006/456 reg 14", status: "missing", summary: "None recorded" },
  { key: "health_safety_policy", provision: "HSWA 1974 s.2(3)", status: "not_required", summary: "Fewer than five employed" },
];

describe("ComplianceChecklist", () => {
  it("shows a spinner while loading, and nothing else", () => {
    render(<ComplianceChecklist checks={undefined} isLoading={true} />);
    expect(screen.getByText(/Computing compliance position/)).toBeInTheDocument();
  });

  it("renders nothing once loading finishes with no data", () => {
    const { container } = render(<ComplianceChecklist checks={undefined} isLoading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per check, with its summary, provision and status badge", () => {
    render(<ComplianceChecklist checks={checks} isLoading={false} />);

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("SSI 2006/456 reg 3")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();

    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Not required")).toBeInTheDocument();

    expect(screen.getAllByRole("listitem")).toHaveLength(checks.length);
  });
});
