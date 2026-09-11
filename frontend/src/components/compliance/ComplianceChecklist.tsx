import type { ComplianceCheck } from "../../lib/api";
import { Badge, CenteredSpinner } from "../ui/primitives";

const STATUS_BADGE: Record<ComplianceCheck["status"], { text: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  ok: { text: "OK", tone: "green" },
  attention: { text: "Needs attention", tone: "amber" },
  missing: { text: "Missing", tone: "red" },
  not_required: { text: "Not required", tone: "neutral" },
};

export function ComplianceChecklist({
  checks,
  isLoading,
}: {
  checks: ComplianceCheck[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) return <CenteredSpinner label="Computing compliance position…" />;
  if (!checks) return null;

  return (
    <ul className="divide-y divide-slate-100">
      {checks.map((check) => {
        const badge = STATUS_BADGE[check.status];
        return (
          <li key={check.key} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{check.summary}</p>
                <p className="mt-0.5 text-xs text-slate-400">{check.provision}</p>
              </div>
              <Badge tone={badge.tone}>{badge.text}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
