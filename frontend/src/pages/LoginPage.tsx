import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/http";
import { Button } from "../components/ui/Button";
import { Card, ApiErrorAlert } from "../components/ui/primitives";
import { TextInput, FormField } from "../components/ui/form";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-red-700 text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              <path d="M12 2c1 3-2 4-2 7a2 2 0 004 0c1 1 2 2.5 2 4.5A5.5 5.5 0 016.5 19c0-2 1-3.5 1-3.5-2 1-3.5 3-3.5 5.5A8 8 0 0012 22a8 8 0 006-13.3C16 6 13 5 12 2z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Fire Safety Records</h1>
          <p className="text-sm text-slate-500">Sign in to your account</p>
        </div>

        <Card className="p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {Boolean(error) && <ApiErrorAlert error={toLoginError(error)} />}

            <FormField label="Email" htmlFor="email" required>
              <TextInput
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField label="Password" htmlFor="password" required>
              <TextInput
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function toLoginError(error: unknown): Error {
  if (error instanceof ApiError) {
    // The API deliberately answers a wrong password and an unknown email the
    // same way; the frontend follows suit rather than adding its own message.
    return new Error(error.message);
  }
  return error instanceof Error ? error : new Error("Sign in failed");
}
