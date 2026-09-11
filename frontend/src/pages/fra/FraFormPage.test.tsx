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

const FraFormPage = (await import("./FraFormPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/fire-risk-assessments/new"]}>
        <Routes>
          <Route path="/fire-risk-assessments/new" element={<FraFormPage />} />
          <Route path="/fire-risk-assessments/:id" element={<p>FRA detail page</p>} />
          <Route path="/fire-risk-assessments" element={<p>FRA list page</p>} />
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

describe("FraFormPage", () => {
  it("seeds premises_id from the globally selected premises, creates a draft and navigates to it", async () => {
    mockSelectedId = 5;
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Selected Site" }], page: {} });
    createResource.mockResolvedValue({ data: { id: 1 } });
    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText(/Premises/) as HTMLSelectElement).value).toBe("5"),
    );
    await userEvent.type(screen.getByLabelText(/Carried out on/), "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/fire-risk-assessments",
        expect.objectContaining({ premises_id: 5, carried_out_on: "2026-01-01" }),
      ),
    );
    await waitFor(() => expect(screen.getByText("FRA detail page")).toBeInTheDocument());
  });

  it("shows the server's rejection without navigating away", async () => {
    mockSelectedId = null;
    listResource.mockResolvedValue({ data: [], page: {} });
    createResource.mockRejectedValue(new Error("Something went wrong"));
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(screen.queryByText("FRA list page")).not.toBeInTheDocument();
  });

  it("cancel returns to the list without creating anything", async () => {
    mockSelectedId = null;
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("FRA list page")).toBeInTheDocument());
    expect(createResource).not.toHaveBeenCalled();
  });
});
