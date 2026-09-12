import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import NotFoundPage from "../NotFoundPage";
import { useUserForm } from "./useUserForm";
import { UserIdentityFields } from "./UserIdentityFields";
import { UserRoleAndStatusFields } from "./UserRoleAndStatusFields";
import { PremisesAccessField } from "./PremisesAccessField";
import { UserFormFooter } from "./UserFormFooter";

export default function UserFormPage() {
  const { id } = useParams();
  const isNew = id === "new" || id === undefined;
  const navigate = useNavigate();
  const { user: me } = useAuth();

  const {
    data,
    isLoading,
    premisesData,
    email,
    setEmail,
    fullName,
    setFullName,
    password,
    setPassword,
    role,
    setRole,
    isActive,
    setIsActive,
    premisesIds,
    setPremisesIds,
    error,
    fieldErrors,
    isSelf,
    locked,
    saveMutation,
    deactivateMutation,
    unlockMutation,
  } = useUserForm(id, isNew, me);

  if (!isNew && isLoading) return <CenteredSpinner label="Loading…" />;
  if (!isNew && !data) return <NotFoundPage />;

  return (
    <div>
      <PageHeader
        title={isNew ? "New user" : email || "Edit user"}
        breadcrumb={[{ label: "Users", to: "/admin/users" }, { label: isNew ? "New" : email }]}
      />

      <Card className="max-w-2xl p-6">
        {Boolean(error) && (
          <div className="mb-4">
            <ApiErrorAlert error={error} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UserIdentityFields
            isNew={isNew}
            email={email}
            setEmail={setEmail}
            fullName={fullName}
            setFullName={setFullName}
            password={password}
            setPassword={setPassword}
            fieldErrors={fieldErrors}
          />
          <UserRoleAndStatusFields
            role={role}
            setRole={setRole}
            isSelf={isSelf}
            fieldErrors={fieldErrors}
            isNew={isNew}
            isActive={isActive}
            setIsActive={setIsActive}
          />
        </div>

        <PremisesAccessField
          role={role}
          premises={premisesData?.data ?? []}
          selectedIds={premisesIds}
          onChange={setPremisesIds}
        />

        {!isNew && locked && (
          <div className="mt-4">
            <Button size="sm" loading={unlockMutation.isPending} onClick={() => unlockMutation.mutate()}>
              Clear lockout
            </Button>
          </div>
        )}

        <UserFormFooter
          isNew={isNew}
          isSelf={isSelf}
          deactivateMutation={deactivateMutation}
          saveMutation={saveMutation}
          onCancel={() => navigate("/admin/users")}
        />
      </Card>
    </div>
  );
}
