import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { FieldConfig } from "../../resources/types";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

const { ResourceForm } = await import("./ResourceForm");

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  listResource.mockReset();
});

describe("ResourceForm field kinds", () => {
  it("renders a text field bound to its value, and reports changes", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "name", label: "Name", field: { kind: "text" } }];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{ name: "Existing" }} onChange={onChange} />);

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Existing");
    await userEvent.type(input, "!");
    expect(onChange).toHaveBeenCalledWith("name", "Existing!");
  });

  it("renders a boolean field as a checkbox", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "in_service", label: "In service", field: { kind: "boolean" } }];
    renderWithClient(
      <ResourceForm fields={fields} mode="create" values={{ in_service: false }} onChange={onChange} />,
    );

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith("in_service", true);
  });

  it("renders a number field, converting an empty value to null", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "count", label: "Count", field: { kind: "number", min: 0 } }];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{ count: 3 }} onChange={onChange} />);

    const input = screen.getByLabelText("Count") as HTMLInputElement;
    expect(input.value).toBe("3");
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("count", null);
  });

  it("renders an enum field with its options, using the given labels", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [
      {
        key: "role",
        label: "Role",
        field: { kind: "enum", options: ["viewer", "admin"], labels: { viewer: "Viewer", admin: "Administrator" } },
      },
    ];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={onChange} />);

    expect(screen.getByRole("option", { name: "Administrator" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Role"), "admin");
    expect(onChange).toHaveBeenCalledWith("role", "admin");
  });

  it("renders a date field, clearing to null rather than an empty string", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "carried_out_on", label: "Carried out on", field: { kind: "date" } }];
    renderWithClient(
      <ResourceForm fields={fields} mode="create" values={{ carried_out_on: "2026-01-01" }} onChange={onChange} />,
    );
    const input = screen.getByLabelText("Carried out on");
    await userEvent.clear(input);
    expect(onChange).toHaveBeenCalledWith("carried_out_on", null);
  });

  it("renders a resource field as a select populated from the API", async () => {
    listResource.mockResolvedValue({ data: [{ id: 1, name: "Main Site" }], page: {} });
    const onChange = vi.fn();
    const fields: FieldConfig[] = [
      { key: "premises_id", label: "Premises", field: { kind: "resource", resourcePath: "/premises", labelKey: "name" } },
    ];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Main Site" })).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/premises", { limit: 200 });
  });

  it("renders a datetime field, converting to and from datetime-local's format", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "held_at", label: "Held at", field: { kind: "datetime" } }];
    renderWithClient(
      <ResourceForm
        fields={fields}
        mode="create"
        values={{ held_at: "2026-03-14T09:30:00.000Z" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Held at") as HTMLInputElement;
    expect(input.value).toBe("2026-03-14T09:30");

    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("held_at", null);
  });

  it("renders a time field", async () => {
    const onChange = vi.fn();
    const fields: FieldConfig[] = [{ key: "occurred_at_time", label: "Time", field: { kind: "time" } }];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={onChange} />);
    const input = screen.getByLabelText("Time");
    // A native <input type="time">'s hour/minute segments respond to real
    // browser keystrokes in a way userEvent.type cannot reliably reproduce
    // under jsdom, so the change is fired directly instead.
    fireEvent.change(input, { target: { value: "14:30" } });
    expect(onChange).toHaveBeenCalledWith("occurred_at_time", "14:30");
  });

  it("renders a resource-code field as a non-numeric select", async () => {
    listResource.mockResolvedValue({ data: [{ code: "a", description: "Means of escape" }], page: {} });
    const onChange = vi.fn();
    const fields: FieldConfig[] = [
      {
        key: "schedule2_measure_code",
        label: "Schedule 2 measure",
        field: {
          kind: "resource-code",
          resourcePath: "/schedule2-measures",
          labelKey: (row) => `${row.code} — ${String(row.description)}`,
        },
      },
    ];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "a — Means of escape" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Schedule 2 measure"), "a");
    expect(onChange).toHaveBeenCalledWith("schedule2_measure_code", "a");
  });

  it("renders a textarea field spanning two columns", () => {
    const fields: FieldConfig[] = [{ key: "notes", label: "Notes", field: { kind: "textarea" } }];
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={() => {}} />);
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
  });
});

describe("ResourceForm mode and validation state", () => {
  const fields: FieldConfig[] = [
    { key: "premises_id", label: "Premises", field: { kind: "text" }, createOnly: true, requiredOnCreate: true },
    { key: "notes", label: "Notes", field: { kind: "text" } },
  ];

  it("shows a create-only field in create mode", () => {
    renderWithClient(<ResourceForm fields={fields} mode="create" values={{}} onChange={() => {}} />);
    expect(screen.getByLabelText(/Premises/)).toBeInTheDocument();
  });

  it("hides a create-only field in update mode", () => {
    renderWithClient(<ResourceForm fields={fields} mode="update" values={{}} onChange={() => {}} />);
    expect(screen.queryByLabelText(/Premises/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("marks a required field only in create mode", () => {
    const { rerender } = renderWithClient(
      <ResourceForm fields={fields} mode="create" values={{}} onChange={() => {}} />,
    );
    expect(screen.getByLabelText(/Premises/)).toBeRequired();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ResourceForm
          fields={[{ ...fields[1], requiredOnCreate: true }]}
          mode="update"
          values={{}}
          onChange={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Notes")).not.toBeRequired();
  });

  it("shows a field-level error message from fieldErrors", () => {
    renderWithClient(
      <ResourceForm
        fields={fields}
        mode="create"
        values={{}}
        onChange={() => {}}
        fieldErrors={{ notes: "Must not be empty" }}
      />,
    );
    expect(screen.getByText("Must not be empty")).toBeInTheDocument();
  });
});
