import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAuditLog } from "../../lib/api";
import { Badge, ApiErrorAlert, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { TextInput, Select } from "../../components/ui/form";

export default function AuditLogPage() {
  const [resource, setResource] = useState("");
  const [outcome, setOutcome] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-log", resource, outcome],
    queryFn: () => listAuditLog({ resource: resource || undefined, outcome: outcome || undefined, limit: 200 }),
  });

  return (
    <div>
      <PageHeader title="Audit log" description="Every create, update, delete, authentication event and refused request." />

      <div className="mb-4 flex gap-3">
        <div className="w-56">
          <TextInput placeholder="Resource (e.g. incidents)" value={resource} onChange={(e) => setResource(e.target.value)} />
        </div>
        <div className="w-44">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failure">Failure</option>
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : isLoading ? (
        <CenteredSpinner />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Resource</th>
                <th className="px-4 py-2.5">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data?.data ?? []).map((entry) => (
                <tr key={String(entry.id)}>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {new Date(entry.occurred_at).toLocaleString("en-GB")}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{entry.user_email ?? "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-300">{entry.action}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {entry.resource ? `${entry.resource}${entry.resource_id ? ` #${entry.resource_id}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Badge tone={entry.outcome === "success" ? "green" : entry.outcome === "denied" ? "amber" : "red"}>
                      {entry.outcome}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
