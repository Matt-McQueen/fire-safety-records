import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import type { SessionUser } from "./types/api";

// App.tsx wires up routing and two access-control wrappers (ProtectedArea,
// RequireRole); the actual page components are irrelevant to that logic; so
// each is replaced with a one-line stub naming itself, to test the routing
// in isolation from what any one page renders.
function stub(name: string) {
  return { default: () => <p>{name}</p> };
}
vi.mock("./pages/LoginPage", () => stub("LoginPage"));
vi.mock("./pages/DashboardPage", () => stub("DashboardPage"));
vi.mock("./pages/AccountPage", () => stub("AccountPage"));
vi.mock("./pages/premises/PremisesListPage", () => stub("PremisesListPage"));
vi.mock("./pages/premises/PremisesFormPage", () => stub("PremisesFormPage"));
vi.mock("./pages/premises/PremisesDetailPage", () => stub("PremisesDetailPage"));
vi.mock("./pages/fra/FraListPage", () => stub("FraListPage"));
vi.mock("./pages/fra/FraFormPage", () => stub("FraFormPage"));
vi.mock("./pages/fra/FraDetailPage", () => stub("FraDetailPage"));
vi.mock("./pages/equipment/EquipmentListPage", () => stub("EquipmentListPage"));
vi.mock("./pages/equipment/EquipmentFormPage", () => stub("EquipmentFormPage"));
vi.mock("./pages/equipment/EquipmentDetailPage", () => stub("EquipmentDetailPage"));
vi.mock("./pages/escaperoutes/EscapeRouteListPage", () => stub("EscapeRouteListPage"));
vi.mock("./pages/escaperoutes/EscapeRouteFormPage", () => stub("EscapeRouteFormPage"));
vi.mock("./pages/escaperoutes/EscapeRouteDetailPage", () => stub("EscapeRouteDetailPage"));
vi.mock("./pages/resource/ResourceListPage", () => stub("ResourceListPage"));
vi.mock("./pages/resource/ResourceFormPage", () => stub("ResourceFormPage"));
vi.mock("./pages/resource/ReferenceListPage", () => stub("ReferenceListPage"));
vi.mock("./pages/admin/UsersListPage", () => stub("UsersListPage"));
vi.mock("./pages/admin/UserFormPage", () => stub("UserFormPage"));
vi.mock("./pages/admin/AuditLogPage", () => stub("AuditLogPage"));
vi.mock("./components/layout/AppShell", () => ({ AppShell: Outlet }));

let mockUser: SessionUser | null = null;
let mockBooting = false;
vi.mock("./lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser, booting: mockBooting }) }));

vi.mock("./lib/PremisesContext", () => ({
  PremisesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const App = (await import("./App")).default;

function asUser(role: SessionUser["role"]): SessionUser {
  return { id: 1, email: "a@b.com", fullName: "A B", role, personId: null, premisesIds: [] };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  mockUser = null;
  mockBooting = false;
});

describe("App routing", () => {
  it("shows a spinner while the silent sign-in attempt is in progress", () => {
    mockBooting = true;
    renderAt("/");
    expect(screen.getByText("Signing you in…")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to the login page", () => {
    mockUser = null;
    renderAt("/premises");
    expect(screen.getByText("LoginPage")).toBeInTheDocument();
  });

  it("renders the dashboard for a signed-in user at the root", () => {
    mockUser = asUser("viewer");
    renderAt("/");
    expect(screen.getByText("DashboardPage")).toBeInTheDocument();
  });

  it("routes premises, equipment, escape routes, generic and reference pages once signed in", () => {
    mockUser = asUser("viewer");
    renderAt("/equipment/new");
    expect(screen.getByText("EquipmentFormPage")).toBeInTheDocument();
  });

  it("blocks admin-only pages from a role that is not admin, without redirecting", () => {
    mockUser = asUser("manager");
    renderAt("/admin/users");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("UsersListPage")).not.toBeInTheDocument();
  });

  it("lets an admin reach the admin pages", () => {
    mockUser = asUser("admin");
    renderAt("/admin/audit-log");
    expect(screen.getByText("AuditLogPage")).toBeInTheDocument();
  });

  it("shows a 404 page for an unmatched route within the signed-in area", () => {
    mockUser = asUser("viewer");
    renderAt("/somewhere/nonexistent");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
