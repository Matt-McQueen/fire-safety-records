import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/AuthContext";
import { usePremises } from "../lib/PremisesContext";
import { fetchCompliance, fetchComplianceSummary } from "../lib/api";
import { ComplianceChecklist } from "../components/compliance/ComplianceChecklist";
import { Badge, Card, CenteredSpinner, PageHeader } from "../components/ui/primitives";
import { Button } from "../components/ui/Button";

export default function DashboardPage() {
  const { user } = useAuth();
  const { premises, isLoading, selectedId, selected } = usePremises();

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ""}`}
        description="A summary of the compliance position across the premises your account can reach."
      />

      {isLoading ? (
        <CenteredSpinner label="Loading premises…" />
      ) : premises.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500 dark:text-slate-400">
          Your account has not been granted access to any premises yet. Ask an administrator to grant access
          under Users.
        </Card>
      ) : selectedId !== null && selected ? (
        <SinglePremisesCompliance premisesId={selectedId} name={String(selected.name)} />
      ) : (
        <PremisesGrid />
      )}
    </div>
  );
}

function SinglePremisesCompliance({ premisesId, name }: { premisesId: number; name: string }) {
  const query = useQueries({
    queries: [{ queryKey: ["compliance", premisesId], queryFn: () => fetchCompliance(premisesId) }],
  })[0];
  const checks = query.data?.data.checks;
  const summary = query.data?.data.summary ?? { ok: 0, attention: 0, missing: 0, not_required: 0 };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{name}</h2>
        <Link to={`/premises/${premisesId}`}>
          <Button size="sm">View premises</Button>
        </Link>
      </div>
      <div className="mb-4 flex gap-3">
        <SummaryPill label="OK" count={summary.ok} tone="green" />
        <SummaryPill label="Needs attention" count={summary.attention} tone="amber" />
        <SummaryPill label="Missing" count={summary.missing} tone="red" />
      </div>
      <Card>
        <ComplianceChecklist checks={checks} isLoading={query.isLoading} />
      </Card>
    </div>
  );
}

// One request for every premises the account can reach, rather than a
// separate fetchCompliance call per premises: see fetchComplianceSummary and
// the backend's complianceSummaryForAccessiblePremises for why - at this
// database's premises count, the old per-premises fan-out (each of which is
// itself ten queries deep) was enough to exhaust the connection pool on
// every single dashboard visit.
function PremisesGrid() {
  const { data, isLoading } = useQuery({
    queryKey: ["compliance-summary"],
    queryFn: fetchComplianceSummary,
  });
  const entries = data?.data ?? [];

  if (isLoading) return <CenteredSpinner label="Loading compliance summary…" />;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(({ premises: p, summary }) => (
        <Link key={p.id} to={`/premises/${p.id}`}>
          <Card className="h-full p-4 transition-shadow hover:shadow-md">
            <p className="mb-2 font-medium text-slate-800 dark:text-slate-200">{p.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.missing > 0 && <Badge tone="red">{summary.missing} missing</Badge>}
              {summary.attention > 0 && <Badge tone="amber">{summary.attention} need attention</Badge>}
              {summary.missing === 0 && summary.attention === 0 && <Badge tone="green">All OK</Badge>}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: "green" | "amber" | "red" }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
      <Badge tone={tone}>{count}</Badge>
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
    </div>
  );
}
