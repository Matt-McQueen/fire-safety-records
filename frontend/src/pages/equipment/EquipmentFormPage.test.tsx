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

const EquipmentFormPage = (await import("./EquipmentFormPage")).default;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/equipment/new"]}>
        <Routes>
          <Route path="/equipment/new" element={<EquipmentFormPage />} />
          <Route path="/equipment/:id" element={<p>Equipment detail page</p>} />
          <Route path="/equipment" element={<p>Equipment list page</p>} />
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

describe("EquipmentFormPage", () => {
  it("seeds premises_id from the globally selected premises", async () => {
    mockSelectedId = 5;
    listResource.mockResolvedValue({ data: [{ id: 5, name: "Selected Site" }], page: {} });
    createResource.mockResolvedValue({ data: { id: 1 } });
    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText(/Premises/) as HTMLSelectElement).value).toBe("5"),
    );

    await userEvent.selectOptions(screen.getByLabelText(/Equipment type/), "extinguisher");
    await userEvent.type(screen.getByLabelText(/Location/), "Kitchen");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/equipment",
        expect.objectContaining({ premises_id: 5, equipment_type: "extinguisher", location: "Kitchen" }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Equipment detail page")).toBeInTheDocument());
  });

  it("shows the server's rejection without navigating away", async () => {
    mockSelectedId = null;
    listResource.mockResolvedValue({ data: [], page: {} });
    createResource.mockRejectedValue(new Error("Something went wrong"));
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(screen.queryByText("Equipment list page")).not.toBeInTheDocument();
  });

  it("cancel returns to the list without creating anything", async () => {
    mockSelectedId = null;
    listResource.mockResolvedValue({ data: [], page: {} });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("Equipment list page")).toBeInTheDocument());
    expect(createResource).not.toHaveBeenCalled();
  });
});
