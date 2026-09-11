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
const listResource = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ createResource, getResource, removeResource, updateResource, listResource }));

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({ usePremises: () => ({ selectedId: mockSelectedId }) }));

const confirmSpy = vi.hoisted(() => vi.fn());
vi.stubGlobal("confirm", confirmSpy);

const ResourceFormPage = (await import("./ResourceFormPage")).default;

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/records/:resourceName/new" element={<ResourceFormPage />} />
          <Route path="/records/:resourceName/:id" element={<ResourceFormPage />} />
          <Route path="/records/:resourceName" element={<p>List page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

afterEach(() => {
  createResource.mockReset();
  getResource.mockReset();
  removeResource.mockReset();
  updateResource.mockReset();
  listResource.mockReset();
  confirmSpy.mockReset();
  mockUser = null;
  mockSelectedId = null;
});

describe("ResourceFormPage", () => {
  it("shows a 404 page for a name that matches no resource, or one with no fields (a reference table)", () => {
    mockUser = asUser("manager");
    renderPage("/records/not-a-real-resource/new");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("creates a record with the values entered, then returns to the list", async () => {
    mockUser = asUser("manager");
    createResource.mockResolvedValue({ data: { id: 9 } });
    renderPage("/records/people/new");

    await userEvent.type(screen.getByLabelText(/Full name/), "Jordan Reid");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith("/people", expect.objectContaining({ full_name: "Jordan Reid" })),
    );
    await waitFor(() => expect(screen.getByText("List page")).toBeInTheDocument());
  });

  it("seeds premises_id from the globally selected premises for a premises-scoped resource", async () => {
    mockUser = asUser("manager");
    mockSelectedId = 7;
    listResource.mockResolvedValue({
      data: [{ id: 7, name: "Selected Site" }, { id: 42, full_name: "A Person" }],
      page: {},
    });
    createResource.mockResolvedValue({ data: { id: 1 } });
    renderPage("/records/safety_roles/new");

    await waitFor(() =>
      expect((screen.getByLabelText(/Premises/) as HTMLSelectElement).value).toBe("7"),
    );

    await userEvent.selectOptions(screen.getByLabelText(/Person/), "42");
    await userEvent.selectOptions(screen.getByLabelText(/Role/), "fire_warden");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        "/safety-roles",
        expect.objectContaining({ premises_id: 7 }),
      ),
    );
  });

  it("loads an existing record and sends only the fields that changed", async () => {
    mockUser = asUser("manager");
    getResource.mockResolvedValue({ data: { id: 3, full_name: "Original Name", job_title: "Warden" } });
    updateResource.mockResolvedValue({ data: { id: 3 } });
    renderPage("/records/people/3");

    const nameInput = await screen.findByDisplayValue("Original Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Revised Name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateResource).toHaveBeenCalledWith("/people", "3", { full_name: "Revised Name" }),
    );
  });

  it("shows a 404 page when the record does not exist", async () => {
    mockUser = asUser("manager");
    getResource.mockRejectedValue(new Error("not found"));
    renderPage("/records/people/999");
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("disables the form and hides Save for a role that may only read", async () => {
    mockUser = asUser("viewer");
    getResource.mockResolvedValue({ data: { id: 3, full_name: "Original Name" } });
    renderPage("/records/people/3");

    await screen.findByDisplayValue("Original Name");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Full name/)).toBeDisabled();
  });

  it("deletes a record after confirmation, and does nothing if the user cancels the prompt", async () => {
    mockUser = asUser("admin");
    getResource.mockResolvedValue({ data: { id: 3, full_name: "Original Name" } });
    removeResource.mockResolvedValue(undefined);
    renderPage("/records/people/3");
    await screen.findByDisplayValue("Original Name");

    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removeResource).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeResource).toHaveBeenCalledWith("/people", "3"));
    await waitFor(() => expect(screen.getByText("List page")).toBeInTheDocument());
  });

  it("shows the server's rejection and stays on the page when saving fails", async () => {
    mockUser = asUser("manager");
    createResource.mockRejectedValue(new Error("Something went wrong"));
    renderPage("/records/people/new");

    await userEvent.type(screen.getByLabelText(/Full name/), "Jordan Reid");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(screen.queryByText("List page")).not.toBeInTheDocument();
  });

  it("cancel returns to the list without saving", async () => {
    mockUser = asUser("manager");
    renderPage("/records/people/new");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("List page")).toBeInTheDocument());
    expect(createResource).not.toHaveBeenCalled();
  });
});
