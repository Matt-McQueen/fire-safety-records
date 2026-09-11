import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ listResource }));

const ReferenceListPage = (await import("./ReferenceListPage")).default;

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reference/:resourceName" element={<ReferenceListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listResource.mockReset();
});

describe("ReferenceListPage", () => {
  it("shows a 404 page for a name that matches no resource", () => {
    renderPage("/reference/not-a-real-resource");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("lists the reference table's rows, searchable and read-only", async () => {
    listResource.mockResolvedValue({
      data: [{ code: "a", instrument: "Fire (Scotland) Act 2005", provision: "s.53", duty: "General duty", is_recording_duty: false }],
      page: {},
    });
    renderPage("/reference/legal_basis");

    await waitFor(() => expect(screen.getByText("Fire (Scotland) Act 2005")).toBeInTheDocument());
    expect(listResource).toHaveBeenCalledWith("/legal-basis", {
      limit: 200,
      sort: "code",
      q: undefined,
    });
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    // A reference table's rows have no fields, so it never links to an edit page.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("searching re-queries with the term", async () => {
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage("/reference/legal_basis");
    await waitFor(() => expect(listResource).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText("Search…"), "reg 9");
    await waitFor(() =>
      expect(listResource).toHaveBeenLastCalledWith("/legal-basis", { limit: 200, sort: "code", q: "reg 9" }),
    );
  });

  it("shows the API error instead of the table when the request fails", async () => {
    listResource.mockRejectedValue(new Error("Server error"));
    renderPage("/reference/legal_basis");
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
  });
});
