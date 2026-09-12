import { ROLES } from "../../types/api";
import { ROLE_LABELS } from "../../lib/roles";
import { Checkbox, FormField, Select } from "../../components/ui/form";

/** The role select, and (for an existing account) the active/inactive
 * checkbox. Extracted from UserFormPage so the edit-only status field's
 * conditional doesn't live in the page's own render. */
export function UserRoleAndStatusFields({
  role,
  setRole,
  isSelf,
  fieldErrors,
  isNew,
  isActive,
  setIsActive,
}: {
  role: string;
  setRole: (value: string) => void;
  isSelf: boolean;
  fieldErrors: Record<string, string>;
  isNew: boolean;
  isActive: boolean;
  setIsActive: (value: boolean) => void;
}) {
  return (
    <>
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
          <Checkbox id="is_active" label="Active" checked={isActive} disabled={isSelf} onChange={(e) => setIsActive(e.target.checked)} />
        </FormField>
      )}
    </>
  );
}
