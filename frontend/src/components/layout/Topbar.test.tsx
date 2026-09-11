import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Row, SessionUser } from "../../types/api";

const logout = vi.hoisted(() => vi.fn());
let mockUser: SessionUser | null = null;
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser, logout }) }));

const setSelectedId = vi.hoisted(() => vi.fn());
let mockPremises: Row[] = [];
let mockSelectedId: number | null = null;
vi.mock("../../lib/PremisesContext", () => ({
  usePremises: () => ({ premises: mockPremises, selectedId: mockSelectedId, setSelectedId }),
}));

const toggleTheme = vi.hoisted(() => vi.fn());
let mockTheme: "light" | "dark" = "light";
vi.mock("../../lib/ThemeContext", () => ({ useTheme: () => ({ theme: mockTheme, toggleTheme }) }));

const { Topbar } = await import("./Topbar");

afterEach(() => {
  mockUser = { id: 1, email: "a@b.com", fullName: "Jordan Reid", role: "manager", personId: null, premisesIds: [] };
  mockPremises = [];
  mockSelectedId = null;
  mockTheme = "light";
  logout.mockReset();
  setSelectedId.mockReset();
  toggleTheme.mockReset();
});

describe("Topbar", () => {
  it("shows the signed-in user's name and role", () => {
    mockUser = { id: 1, email: "a@b.com", fullName: "Jordan Reid", role: "manager", personId: null, premisesIds: [] };
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Jordan Reid")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
  });

  it("lists the premises the picker offers, and reflects the current selection", () => {
    mockPremises = [
      { id: 1, name: "First Premises" },
      { id: 2, name: "Second Premises" },
    ];
    mockSelectedId = 2;
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox", { name: "Premises" }) as HTMLSelectElement;
    expect(select.value).toBe("2");
    expect(screen.getByRole("option", { name: "First Premises" })).toBeInTheDocument();
  });

  it("selecting a premises calls setSelectedId with a number, or null for 'All premises'", async () => {
    mockPremises = [{ id: 1, name: "First Premises" }];
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Premises" }), "1");
    expect(setSelectedId).toHaveBeenCalledWith(1);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Premises" }), "All premises");
    expect(setSelectedId).toHaveBeenCalledWith(null);
  });

  it("toggles the theme when the theme button is clicked", async () => {
    mockTheme = "light";
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("opens the account menu and signs out", async () => {
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("Jordan Reid"));
    const signOut = await screen.findByText("Sign out");
    await userEvent.click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("closes the account menu when clicking away from it", async () => {
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("Jordan Reid"));
    expect(await screen.findByText("Sign out")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
  });

  it("navigates to the account page to change password", async () => {
    render(
      <MemoryRouter>
        <Topbar onMenuClick={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("Jordan Reid"));
    await userEvent.click(await screen.findByText("Change password"));
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
  });

  it("calls onMenuClick from the mobile menu button", async () => {
    const onMenuClick = vi.fn();
    render(
      <MemoryRouter>
        <Topbar onMenuClick={onMenuClick} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });
});
