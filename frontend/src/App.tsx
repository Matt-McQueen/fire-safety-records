import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { PremisesProvider } from "./lib/PremisesContext";
import { atLeast } from "./lib/roles";
import type { Role } from "./types/api";
import { AppShell } from "./components/layout/AppShell";
import { CenteredSpinner } from "./components/ui/primitives";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import AccountPage from "./pages/AccountPage";
import NotFoundPage from "./pages/NotFoundPage";
import PremisesListPage from "./pages/premises/PremisesListPage";
import PremisesFormPage from "./pages/premises/PremisesFormPage";
import PremisesDetailPage from "./pages/premises/PremisesDetailPage";
import FraListPage from "./pages/fra/FraListPage";
import FraFormPage from "./pages/fra/FraFormPage";
import FraDetailPage from "./pages/fra/FraDetailPage";
import EquipmentListPage from "./pages/equipment/EquipmentListPage";
import EquipmentFormPage from "./pages/equipment/EquipmentFormPage";
import EquipmentDetailPage from "./pages/equipment/EquipmentDetailPage";
import EscapeRouteListPage from "./pages/escaperoutes/EscapeRouteListPage";
import EscapeRouteFormPage from "./pages/escaperoutes/EscapeRouteFormPage";
import EscapeRouteDetailPage from "./pages/escaperoutes/EscapeRouteDetailPage";
import ResourceListPage from "./pages/resource/ResourceListPage";
import ResourceFormPage from "./pages/resource/ResourceFormPage";
import ReferenceListPage from "./pages/resource/ReferenceListPage";
import UsersListPage from "./pages/admin/UsersListPage";
import UserFormPage from "./pages/admin/UserFormPage";
import AuditLogPage from "./pages/admin/AuditLogPage";

function ProtectedArea({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) return <CenteredSpinner label="Signing you in…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  return <PremisesProvider>{children}</PremisesProvider>;
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !atLeast(user.role, role)) return <NotFoundPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/*"
        element={
          <ProtectedArea>
            <AppShell />
          </ProtectedArea>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="account" element={<AccountPage />} />

        <Route path="premises" element={<PremisesListPage />} />
        <Route path="premises/new" element={<PremisesFormPage />} />
        <Route path="premises/:id" element={<PremisesDetailPage />} />
        <Route path="premises/:id/edit" element={<PremisesFormPage />} />

        <Route path="fire-risk-assessments" element={<FraListPage />} />
        <Route path="fire-risk-assessments/new" element={<FraFormPage />} />
        <Route path="fire-risk-assessments/:id" element={<FraDetailPage />} />

        <Route path="equipment" element={<EquipmentListPage />} />
        <Route path="equipment/new" element={<EquipmentFormPage />} />
        <Route path="equipment/:id" element={<EquipmentDetailPage />} />

        <Route path="escape-routes" element={<EscapeRouteListPage />} />
        <Route path="escape-routes/new" element={<EscapeRouteFormPage />} />
        <Route path="escape-routes/:id" element={<EscapeRouteDetailPage />} />

        <Route path="records/:resourceName" element={<ResourceListPage />} />
        <Route path="records/:resourceName/new" element={<ResourceFormPage />} />
        <Route path="records/:resourceName/:id" element={<ResourceFormPage />} />

        <Route path="reference/:resourceName" element={<ReferenceListPage />} />

        <Route
          path="admin/users"
          element={
            <RequireRole role="admin">
              <UsersListPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/users/:id"
          element={
            <RequireRole role="admin">
              <UserFormPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/audit-log"
          element={
            <RequireRole role="admin">
              <AuditLogPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
