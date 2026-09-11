import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types/api";

const createResource = vi.hoisted(() => vi.fn());
const getResource = vi.hoisted(() => vi.fn());
const removeResource = vi.hoisted(() => vi.fn());
const updateResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ createResource, getResource, removeResource, updateResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const confirmSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("confirm", confirmSpy);

const PremisesFormPage = (await import("./PremisesFormPage")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/premises/new" element={<PremisesFormPage />} />
          <Route path="/premises/:id/edit" element={<PremisesFormPage />} />
          <Route path="/premises/:id" element={<p>Premises detail page</p>} />
          <Route path="/premises" element={<p>Premises list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  createResource.mockReset();
  getResource.mockReset();
  removeResource.mockReset();
  updateResource.mockReset();
  confirmSpy.mockReset();
  mockUser = null;
});

describe("PremisesFormPage — creating", () => {
  it("creates a premises and navigates to its detail page", async () => {
    mockUser = asUser("manager");
    createResource.mockResolvedValue({ data: { id: 9 } });
    renderPage("/premises/new");

    await userEvent.type(screen.getByLabelText(/Name/), "New Site");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith("/premises", expect.objectContaining({ name: "New Site" })),
    );
    await waitFor(() => expect(screen.getByText("Premises detail page")).toBeInTheDocument());
  });
});

describe("PremisesFormPage — editing", () => {
  it("loads the existing record and sends only what changed", async () => {
    mockUser = asUser("manager");
    getResource.mockResolvedValue({ data: { id: 3, name: "Original Name", town: "Glasgow" } });
    updateResource.mockResolvedValue({ data: { id: 3 } });
    renderPage("/premises/3/edit");

    const nameInput = await screen.findByDisplayValue("Original Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Revised Name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateResource).toHaveBeenCalledWith("/premises", "3", { name: "Revised Name" }),
    );
  });

  it("only offers Delete to an admin", async () => {
    getResource.mockResolvedValue({ data: { id: 3, name: "Original Name" } });

    mockUser = asUser("manager");
    const { unmount } = renderPage("/premises/3/edit");
    await screen.findByDisplayValue("Original Name");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    unmount();

    mockUser = asUser("admin");
    renderPage("/premises/3/edit");
    await screen.findByDisplayValue("Original Name");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes only after confirmation, then returns to the list", async () => {
    mockUser = asUser("admin");
    getResource.mockResolvedValue({ data: { id: 3, name: "Original Name" } });
    removeResource.mockResolvedValue(undefined);
    renderPage("/premises/3/edit");
    await screen.findByDisplayValue("Original Name");

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removeResource).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/premises", "3"));
    await waitFor(() => expect(screen.getByText("Premises list page")).toBeInTheDocument());
  });

  it("shows a 404 page for a premises that does not exist", async () => {
    mockUser = asUser("manager");
    getResource.mockRejectedValue(new Error("not found"));
    renderPage("/premises/999/edit");
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });
});
