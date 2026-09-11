import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { Row, SessionUser } from "../../types/api";

let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, logout: vi.fn() }),
}));

let mockPremises: Row[] = [];
vi.mock("../../lib/PremisesContext", () => ({
  usePremises: () => ({ premises: mockPremises, selectedId: null, setSelectedId: vi.fn() }),
}));

vi.mock("../../lib/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

const { AppShell } = await import("./AppShell");

afterEach(() => {
  mockUser = null;
  mockPremises = [];
});

function renderShell() {
  const router = createMemoryRouter(
    [{ path: "/", element: <AppShell />, children: [{ index: true, element: <p>Page content</p> }] }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("AppShell", () => {
  it("renders the topbar, the sidebar and the routed page content", () => {
    mockUser = { id: 1, email: "a@b.com", fullName: "Jordan Reid", role: "manager", personId: null, premisesIds: [] };
    renderShell();

    expect(screen.getByText("Fire Safety Records")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("opens and closes the mobile sidebar", async () => {
    mockUser = { id: 1, email: "a@b.com", fullName: "Jordan Reid", role: "manager", personId: null, premisesIds: [] };
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    // Two Sidebars now exist: the always-present desktop one and the mobile overlay one.
    expect(screen.getAllByRole("link", { name: "Dashboard" }).length).toBeGreaterThan(1);

    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.getAllByRole("link", { name: "Dashboard" })).toHaveLength(1);
  });
});
