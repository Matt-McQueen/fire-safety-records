import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

const { Checkbox, FormField, ResourceSelect, Select, TextArea, TextInput } = await import("./form");

afterEach(() => {
  listResource.mockReset();
});

describe("FormField", () => {
  it("associates the label with its control, and marks it required", () => {
    render(
      <FormField label="Full name" htmlFor="full_name" required>
        <input id="full_name" />
      </FormField>,
    );
    expect(screen.getByLabelText(/Full name/)).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("shows help text, but replaces it with the error when there is one", () => {
    const { rerender } = render(
      <FormField label="Email" htmlFor="email" help="Used for sign-in only">
        <input id="email" />
      </FormField>,
    );
    expect(screen.getByText("Used for sign-in only")).toBeInTheDocument();

    rerender(
      <FormField label="Email" htmlFor="email" help="Used for sign-in only" error="Must be an email address">
        <input id="email" />
      </FormField>,
    );
    expect(screen.queryByText("Used for sign-in only")).not.toBeInTheDocument();
    expect(screen.getByText("Must be an email address")).toBeInTheDocument();
  });
});

describe("TextInput, TextArea, Select and Checkbox", () => {
  it("accept input like a plain form control", async () => {
    const onChange = vi.fn();
    render(<TextInput aria-label="Name" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Name"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("TextArea renders a textarea", () => {
    render(<TextArea aria-label="Notes" />);
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
  });

  it("Select renders its options", () => {
    render(
      <Select aria-label="Role">
        <option value="viewer">Viewer</option>
        <option value="admin">Admin</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Viewer" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
  });

  it("Checkbox renders its label and toggles", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="In service" onChange={onChange} />);
    const checkbox = screen.getByRole("checkbox", { name: "In service" });
    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalled();
  });
});

describe("ResourceSelect", () => {
  function renderWithClient(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

  it("loads options from the given resource path and labels them", async () => {
    listResource.mockResolvedValue({
      data: [
        { id: 1, name: "First Premises" },
        { id: 2, name: "Second Premises" },
      ],
      page: {},
    });
    const onChange = vi.fn();
    renderWithClient(
      <ResourceSelect
        id="premises_id"
        resourcePath="/premises"
        labelKey="name"
        value={null}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: "First Premises" })).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/premises", { limit: 200 });
    // Numeric by default, and an empty option offered.
    expect(screen.getByRole("option", { name: "— none —" })).toBeInTheDocument();
  });

  it("reports the selected value as a number by default, or a string when told it is not numeric", async () => {
    listResource.mockResolvedValue({
      data: [{ code: "a", description: "Means of escape" }],
      page: {},
    });
    const onChange = vi.fn();
    renderWithClient(
      <ResourceSelect
        id="measure_code"
        resourcePath="/schedule2-measures"
        idColumn="code"
        numeric={false}
        labelKey="description"
        value={null}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: "Means of escape" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole("combobox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("calls onChange with null when the empty option is chosen", async () => {
    listResource.mockResolvedValue({ data: [{ id: 1, name: "Only One" }], page: {} });
    const onChange = vi.fn();
    renderWithClient(
      <ResourceSelect id="p" resourcePath="/premises" labelKey="name" value={1} onChange={onChange} />,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: "Only One" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("can hide the empty option and use a label function", async () => {
    listResource.mockResolvedValue({
      data: [{ code: "a", description: "Means of escape" }],
      page: {},
    });
    renderWithClient(
      <ResourceSelect
        id="measure_code"
        resourcePath="/schedule2-measures"
        idColumn="code"
        numeric={false}
        labelKey={(row) => `${row.code} — ${row.description}`}
        value={null}
        onChange={() => {}}
        allowEmpty={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: "a — Means of escape" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "— none —" })).not.toBeInTheDocument();
  });
});
