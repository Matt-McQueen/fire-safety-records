import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { changePassword } from "../lib/authService";
import { useAuth } from "../lib/AuthContext";
import { Button } from "../components/ui/Button";
import { Alert, ApiErrorAlert, Card, PageHeader } from "../components/ui/primitives";
import { FormField, TextInput } from "../components/ui/form";

export default function AccountPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => setDone(true),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  if (done) {
    return (
      <div className="max-w-md">
        <PageHeader title="Change password" />
        <Alert tone="success" title="Password changed">
          Every session on this account has been signed out, this one included. Sign in again with your new
          password.
        </Alert>
        <Button className="mt-4" variant="primary" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <PageHeader title="Change password" description={`Signed in as ${user?.email}`} />
      <Card className="p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          {mutation.error && <ApiErrorAlert error={mutation.error} />}

          <FormField label="Current password" htmlFor="currentPassword" required>
            <TextInput
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </FormField>

          <FormField label="New password" htmlFor="newPassword" required help="At least 12 characters.">
            <TextInput
              id="newPassword"
              type="password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </FormField>

          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
