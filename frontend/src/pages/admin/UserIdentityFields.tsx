import { FormField, TextInput } from "../../components/ui/form";

/** Email, full name, and (for a new account) the initial password. Extracted
 * from UserFormPage so the new-account-only password field's conditional
 * doesn't live in the page's own render. */
export function UserIdentityFields({
  isNew,
  email,
  setEmail,
  fullName,
  setFullName,
  password,
  setPassword,
  fieldErrors,
}: {
  isNew: boolean;
  email: string;
  setEmail: (value: string) => void;
  fullName: string;
  setFullName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  fieldErrors: Record<string, string>;
}) {
  return (
    <>
      <FormField label="Email" htmlFor="email" required error={fieldErrors.email}>
        <TextInput id="email" type="email" disabled={!isNew} value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <TextInput id="password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
      )}
    </>
  );
}
