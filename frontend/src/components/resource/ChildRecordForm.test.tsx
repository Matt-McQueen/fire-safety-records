import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { FieldConfig } from "../../resources/types";
import { ApiError } from "../../lib/http";

const createResource = vi.hoisted(() => vi.fn());
const updateResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ createResource, updateResource }));

const { ChildRecordForm } = await import("./ChildRecordForm");

const fields: FieldConfig[] = [
  { key: "finding", label: "Finding", field: { kind: "textarea" }, requiredOnCreate: true },
];

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  createResource.mockReset();
  updateResource.mockReset();
});

describe("ChildRecordForm — creating", () => {
  it("creates a record against the given parent, merging the parent key into the body", async () => {
    createResource.mockResolvedValue({ data: { id: 1 } });
    const onDone = vi.fn();
    renderWithClient(
      <ChildRecordForm
        path="/fra-significant-findings"
        fields={fields}
        parentKey="fire_risk_assessment_id"
        parentId={42}
        onDone={onDone}
        onCancel={() => {}}
      />,
    );

    await userEvent.type(screen.getByLabelText(/Finding/), "Fire door wedged open");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith("/fra-significant-findings", {
        finding: "Fire door wedged open",
        fire_risk_assessment_id: 42,
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("shows the server's field errors on failure, and does not call onDone", async () => {
    const error = new ApiError(422, {
      code: "rule_violation",
      message: "A business rule refused this",
      details: { fields: [{ field: "finding", message: "Must not be empty" }] },
    });
    createResource.mockRejectedValue(error);
    const onDone = vi.fn();
    renderWithClient(
      <ChildRecordForm path="/fra-significant-findings" fields={fields} onDone={onDone} onCancel={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText("A business rule refused this")).toBeInTheDocument());
    expect(screen.getByText("Must not be empty")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls onCancel without submitting anything", async () => {
    const onCancel = vi.fn();
    renderWithClient(
      <ChildRecordForm path="/fra-significant-findings" fields={fields} onDone={() => {}} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createResource).not.toHaveBeenCalled();
  });
});

describe("ChildRecordForm — editing", () => {
  it("sends only the fields that actually changed", async () => {
    updateResource.mockResolvedValue({ data: { id: 7 } });
    const onDone = vi.fn();
    renderWithClient(
      <ChildRecordForm
        path="/fra-significant-findings"
        fields={fields}
        recordId={7}
        initialValues={{ id: 7, finding: "Original wording" }}
        onDone={onDone}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    const textarea = screen.getByLabelText("Finding");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Revised wording");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateResource).toHaveBeenCalledWith("/fra-significant-findings", 7, {
        finding: "Revised wording",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("sends nothing when no field actually changed", async () => {
    updateResource.mockResolvedValue({ data: { id: 7 } });
    renderWithClient(
      <ChildRecordForm
        path="/fra-significant-findings"
        fields={fields}
        recordId={7}
        initialValues={{ id: 7, finding: "Unchanged" }}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateResource).toHaveBeenCalledWith("/fra-significant-findings", 7, {}));
  });
});
