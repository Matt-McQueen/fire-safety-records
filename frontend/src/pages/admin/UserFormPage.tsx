import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, deactivateUser, getUser, listResource, updateUser } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { ROLES } from "../../types/api";
import { ROLE_LABELS } from "../../lib/roles";
import { ApiError } from "../../lib/http";
import { Button } from "../../components/ui/Button";
import { ApiErrorAlert, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { Checkbox, FormField, Select, TextInput } from "../../components/ui/form";
import NotFoundPage from "../NotFoundPage";

export default function UserFormPage() {
  const { id } = useParams();
  const isNew = id === "new" || id === undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(Number(id)),
    enabled: !isNew,
  });

  const { data: premisesData } = useQuery({
    queryKey: ["premises", "picker-all"],
    queryFn: () => listResource("/premises", { limit: 200, sort: "name" }),
  });

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [isActive, setIsActive] = useState(true);
  const [premisesIds, setPremisesIds] = useState<number[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data) {
      setEmail(data.data.email);
      setFullName(data.data.full_name);
      setRole(data.data.role);
      setIsActive(data.data.is_active);
      setPremisesIds(data.data.premises_ids);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return createUser({ email, full_name: fullName, password, role, premises_ids: premisesIds });
      }
      return updateUser(Number(id), {
        full_name: fullName,
        role,
        is_active: isActive,
        premises_ids: premisesIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      navigate("/admin/users");
    },
    onError: setError,
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateUser(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      navigate("/admin/users");
    },
    onError: setError,
  });

  const unlockMutation = useMutation({
    mutationFn: () => updateUser(Number(id), { unlock: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", id] }),
    onError: setError,
  });

  if (!isNew && isLoading) return <CenteredSpinner label="Loading…" />;
  if (!isNew && !data) return <NotFoundPage />;

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};
  const isSelf = !isNew && me?.id === Number(id);
  const locked = data?.data.locked_until && new Date(data.data.locked_until) > new Date();

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
          <FormField label="Email" htmlFor="email" required error={fieldErrors.email}>
            <TextInput
              id="email"
              type="email"
              disabled={!isNew}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Full name" htmlFor="full_name" required error={fieldErrors.full_name}>
            <TextInput id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </FormField>

          {isNew && (
            <FormField
              label="Initial password"
              htmlFor="password"
              required
              help="At least 12 characters. The user should change it after first sign-in."
              error={fieldErrors.password}
            >
              <TextInput
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
          )}

          <FormField label="Role" htmlFor="role" required error={fieldErrors.role}>
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf && role === "admin"}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>

          {!isNew && (
            <FormField label="Status" htmlFor="is_active">
              <Checkbox
                id="is_active"
                label="Active"
                checked={isActive}
                disabled={isSelf}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            </FormField>
          )}
        </div>

        {role !== "admin" && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Premises access</p>
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-slate-200 p-3 sm:grid-cols-2">
              {(premisesData?.data ?? []).map((p) => (
                <Checkbox
                  key={String(p.id)}
                  label={String(p.name)}
                  checked={premisesIds.includes(Number(p.id))}
                  onChange={(e) => {
                    const pid = Number(p.id);
                    setPremisesIds((prev) => (e.target.checked ? [...prev, pid] : prev.filter((x) => x !== pid)));
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {role === "admin" && <p className="mt-4 text-sm text-slate-500">An admin account reaches every premises.</p>}

        {!isNew && locked && (
          <div className="mt-4">
            <Button size="sm" loading={unlockMutation.isPending} onClick={() => unlockMutation.mutate()}>
              Clear lockout
            </Button>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            {!isNew && !isSelf && (
              <Button
                variant="danger"
                loading={deactivateMutation.isPending}
                onClick={() => {
                  if (confirm("Deactivate this account? Its sessions will be signed out.")) {
                    deactivateMutation.mutate();
                  }
                }}
              >
                Deactivate
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate("/admin/users")}>
              Cancel
            </Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {isNew ? "Create" : "Save changes"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
