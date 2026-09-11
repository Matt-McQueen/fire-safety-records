import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResourceTable } from "./ResourceTable";
import type { ColumnConfig } from "../../resources/types";
import type { Row } from "../../types/api";

const columns: ColumnConfig[] = [
  { key: "name", label: "Name" },
  { key: "in_service", label: "In service" },
  {
    key: "status",
    label: "Status",
    badge: (row) => (row.overdue ? { text: "Overdue", tone: "amber" } : null),
  },
  { key: "kind", label: "Kind", render: (row) => `Rendered: ${String(row.kind)}` },
];

const rows: Row[] = [
  { id: 1, name: "Extinguisher A", in_service: true, overdue: false, kind: "extinguisher" },
  { id: 2, name: "Extinguisher B", in_service: false, overdue: true, kind: "extinguisher", notes: null },
];

describe("ResourceTable", () => {
  it("shows a spinner while loading, before anything else", () => {
    render(<ResourceTable columns={columns} rows={[]} isLoading={true} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows an empty state once loading finishes with no rows", () => {
    render(
      <ResourceTable
        columns={columns}
        rows={[]}
        isLoading={false}
        emptyTitle="No equipment recorded"
        emptyMessage="Add the first item"
      />,
    );
    expect(screen.getByText("No equipment recorded")).toBeInTheDocument();
    expect(screen.getByText("Add the first item")).toBeInTheDocument();
  });

  it("renders one row per record, with a column header for each column", () => {
    render(<ResourceTable columns={columns} rows={rows} isLoading={false} />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1); // + header row
  });

  it("prefers a column's badge over its render function or the raw value", () => {
    render(<ResourceTable columns={columns} rows={rows} isLoading={false} />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("falls back to a column's render function when there is no badge", () => {
    render(<ResourceTable columns={columns} rows={rows} isLoading={false} />);
    expect(screen.getAllByText("Rendered: extinguisher")).toHaveLength(2);
  });

  it("formats booleans and blanks when a column has neither a badge nor a render function", () => {
    render(<ResourceTable columns={columns} rows={rows} isLoading={false} />);
    expect(screen.getByText("Yes")).toBeInTheDocument(); // row 1's in_service: true
    expect(screen.getByText("No")).toBeInTheDocument(); // row 2's in_service: false
  });

  it("wraps each cell in a link when linkTo is given", () => {
    render(
      <MemoryRouter>
        <ResourceTable
          columns={columns}
          rows={rows}
          isLoading={false}
          linkTo={(row) => `/equipment/${row.id}`}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Extinguisher A" });
    expect(link).toHaveAttribute("href", "/equipment/1");
  });

  it("does not render links when linkTo is not given", () => {
    render(<ResourceTable columns={columns} rows={rows} isLoading={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
