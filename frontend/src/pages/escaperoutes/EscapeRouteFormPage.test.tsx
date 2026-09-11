import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const createResource = vi.hoisted(() => vi.fn());
const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ createResource, listResource }));

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const EscapeRouteFormPage = (await import("./EscapeRouteFormPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/escape-routes/new"]}>
        <Routes>
          <Route path="/escape-routes/new" element={<EscapeRouteFormPage />} />
          <Route path="/escape-routes/:id" element={<p>Escape route detail page</p>} />
          <Route path="/escape-routes" element={<p>Escape route list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  createResource.mockReset();
  listResource.mockReset();
  mockSelectedId = null;
});

describe("EscapeRouteFormPage", () => {
  it("seeds premises_id from the globally selected premises, and navigates to the new route", async () => {
    mockSelectedId = 5;
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Selected Site" }], page: {} });
    createResource.mockResolvedValue({ data: { id: 1 } });
    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText(/Premises/) as HTMLSelectElement).value).toBe("5"),
    );
    await userEvent.type(screen.getByLabelText(/Name/), "Stair 2");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/escape-routes",
        expect.objectContaining({ premises_id: 5, name: "Stair 2" }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Escape route detail page")).toBeInTheDocument());
  });

  it("cancel returns to the list without creating anything", async () => {
    mockSelectedId = null;
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("Escape route list page")).toBeInTheDocument());
    expect(createResource).not.toHaveBeenCalled();
  });
});
