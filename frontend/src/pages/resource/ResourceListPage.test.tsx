import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const ResourceListPage = (await import("./ResourceListPage")).default;

function renderPage(path = "/records/people") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/records/:resourceName" element={<ResourceListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

// The filter/sort/order selects sit beside a plain <label> with no htmlFor,
// so they have no accessible name of their own — this finds the select next
// to a given label's text instead.
function comboboxNextTo(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  return within(label.parentElement!).getByRole("combobox");
}

afterEach(() => {
  listResource.mockReset();
  mockUser = null;
  mockSelectedId = null;
});

describe("ResourceListPage", () => {
  it("shows a 404 page for a name that matches no resource", () => {
    mockUser = asUser("viewer");
    renderPage("/records/not-a-real-resource");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("lists rows with the resource's default sort and no filters applied", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({
      data: [{ id: 1, full_name: "Jordan Reid", job_title: "Fire Warden", is_employee: true }],
      page: { total: 1 },
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Jordan Reid")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/people", {
      limit: 25,
      offset: 0,
      sort: "full_name",
      order: "asc",
      q: undefined,
    });
    // Rows link to the edit page, since people has editable fields.
    expect(screen.getByRole("link", { name: /Jordan Reid/ })).toHaveAttribute("href", "/records/people/1");
  });

  it("only offers 'New' to a role that may create the resource", async () => {
    listResource.mockResolvedValue({ data: [], page: { total: 0 } });

    mockUser = asUser("viewer");
    const { unmount } = renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /New person/ })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("manager");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /New person/ })).toBeInTheDocument());
  });

  it("searching on Enter updates the query and resets to the first page", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: { total: 0 } });
    renderPage("/records/people?offset=25");
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText("Search…"), "Reid{Enter}");

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith("/people", {
        limit: 25,
        offset: 0,
        sort: "full_name",
        order: "asc",
        q: "Reid",
      }),
    );
  });

  it("a boolean filter re-queries with the chosen value", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: { total: 0 } });
    renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(comboboxNextTo("Employee"), "Yes");

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith("/people", {
        limit: 25,
        offset: 0,
        sort: "full_name",
        order: "asc",
        q: undefined,
        is_employee: "true",
      }),
    );
  });

  it("changing the sort order re-queries", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [], page: { total: 0 } });
    renderPage();
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(comboboxNextTo("Order"), "Descending");

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith(
        "/people",
        expect.objectContaining({ order: "desc" }),
      ),
    );
  });

  it("paginates using the next/previous controls", async () => {
    mockUser = asUser("viewer");
    listResource.mockResolvedValue({ data: [{ id: 1, full_name: "A" }], page: { total: 60 } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith(
        "/people",
        expect.objectContaining({ offset: 25 }),
      ),
    );
  });

  it("shows the API error instead of the table when the request fails", async () => {
    mockUser = asUser("viewer");
    listResource.mockRejectedValue(new Error("Server error"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
