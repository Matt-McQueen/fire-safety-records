import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listAuditLog = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listAuditLog }));

const AuditLogPage = (await import("./AuditLogPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listAuditLog.mockReset();
});

describe("AuditLogPage", () => {
  it("shows a spinner before the log loads", () => {
    listAuditLog.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("lists entries with who, what and the outcome", async () => {
    listAuditLog.mockResolvedValue({
      data: [
        {
          id: 1,
          occurred_at: "2026-01-01T09:00:00.000Z",
          user_email: "manager@example.test",
          action: "incidents.create",
          resource: "incidents",
          resource_id: 42,
          outcome: "success",
        },
      ],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("manager@example.test")).toBeInTheDocument());
    expect(screen.getByText("incidents.create")).toBeInTheDocument();
    expect(screen.getByText("incidents #42")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("shows a dash for a system entry with no user or resource", async () => {
    listAuditLog.mockResolvedValue({
      data: [
        {
          id: 2,
          occurred_at: "2026-01-01T09:00:00.000Z",
          user_email: null,
          action: "auth.login",
          resource: null,
          resource_id: null,
          outcome: "denied",
        },
      ],
      page: {},
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("auth.login")).toBeInTheDocument());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("filtering by resource and outcome re-queries", async () => {
    listAuditLog.mockResolvedValue({ data: [], page: {} });
    renderPage();
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText("Resource (e.g. incidents)"), "incidents");
    await waitFor(() =>
      expect(listAuditLog).toHaveBeenLastCalledWith({ resource: "incidents", outcome: undefined, limit: 200 }),
    );

    await userEvent.selectOptions(screen.getByRole("combobox"), "Denied");
    await waitFor(() =>
      expect(listAuditLog).toHaveBeenLastCalledWith({ resource: "incidents", outcome: "denied", limit: 200 }),
    );
  });

  it("shows the API error instead of the table on failure", async () => {
    listAuditLog.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
