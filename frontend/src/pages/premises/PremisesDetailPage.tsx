import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getResource, fetchCompliance } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { GENERIC_RESOURCES } from "../../resources/configs";
import { Badge, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ComplianceChecklist } from "../../components/compliance/ComplianceChecklist";
import NotFoundPage from "../NotFoundPage";

const TABS = ["Overview", "Compliance", "Records"] as const;

export default function PremisesDetailPage() {
  const { id } = useParams();
  const premisesId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  const { data, isLoading } = useQuery({
    queryKey: ["resource", "premises", id],
    queryFn: () => getResource("/premises", premisesId),
  });

  const complianceQuery = useQuery({
    queryKey: ["compliance", premisesId],
    queryFn: () => fetchCompliance(premisesId),
    enabled: tab === "Compliance",
  });

  if (isLoading) return <CenteredSpinner label="Loading…" />;
  if (!data) return <NotFoundPage />;

  const premises = data.data;
  const canEdit = user !== null && atLeast(user.role, "manager");

  return (
    <div>
      <PageHeader
        title={String(premises.name)}
        breadcrumb={[{ label: "Premises", to: "/premises" }, { label: String(premises.name) }]}
        actions={
          <>
            <Link to={`/fire-risk-assessments?premises_id=${premisesId}`}>
              <Button>Fire risk assessments</Button>
            </Link>
            {canEdit && <Button onClick={() => navigate(`/premises/${premisesId}/edit`)}>Edit</Button>}
          </>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? "border-red-700 text-red-800 dark:text-red-300" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab premises={premises} />}
      {tab === "Compliance" && (
        <Card>
          <ComplianceChecklist checks={complianceQuery.data?.data.checks} isLoading={complianceQuery.isLoading} />
        </Card>
      )}
      {tab === "Records" && <RecordsTab premisesId={premisesId} />}
    </div>
  );
}

// Already a data-array + map, the usual way to keep a field-display block
// flat; the remaining branches are per-field fallbacks and status badges, not
// accumulated control flow.
// fallow-ignore-next-line complexity
function OverviewTab({ premises }: { premises: Record<string, unknown> }) {
  const rows: [string, unknown][] = [
    ["Address", [premises.address_line1, premises.address_line2, premises.town, premises.postcode].filter(Boolean).join(", ") || "—"],
    ["Duty holder", premises.duty_holder_name || "—"],
    ["Duty holder role", premises.duty_holder_role || "—"],
    ["Employee count", premises.employee_count ?? "—"],
    ["Requires licence", premises.requires_licence ? "Yes" : "No"],
    ["Licence details", premises.licence_details || "—"],
    ["Enforcing authority", premises.enforcing_authority || "—"],
    ["Multi-occupancy", premises.is_multi_occupancy ? "Yes" : "No"],
  ];

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {Boolean(premises.trigger_five_or_more_employees) && <Badge tone="blue">5+ employees</Badge>}
        {Boolean(premises.trigger_licensed_premises) && <Badge tone="blue">Licensed premises</Badge>}
        {Boolean(premises.trigger_alterations_notice) && <Badge tone="blue">Alterations notice in force</Badge>}
        {premises.recording_duty_applies ? (
          <Badge tone="green">Duty to record applies</Badge>
        ) : (
          <Badge tone="neutral">Duty to record not triggered</Badge>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="text-sm text-slate-800 dark:text-slate-200">{String(value)}</dd>
          </div>
        ))}
      </dl>
      {Boolean(premises.notes) && (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</dt>
          <dd className="mt-1 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200">{String(premises.notes)}</dd>
        </div>
      )}
    </Card>
  );
}

function RecordsTab({ premisesId }: { premisesId: number }) {
  const links = [
    { label: "Fire risk assessments", to: `/fire-risk-assessments?premises_id=${premisesId}` },
    { label: "Equipment", to: `/equipment?premises_id=${premisesId}` },
    { label: "Escape routes", to: `/escape-routes?premises_id=${premisesId}` },
    ...GENERIC_RESOURCES.filter((r) => r.premisesScoped).map((r) => ({
      label: r.labelPlural,
      to: `/records/${r.name}?premises_id=${premisesId}`,
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <Link key={link.to} to={link.to}>
          <Card className="p-4 text-sm font-medium text-slate-700 dark:text-slate-300 transition-shadow hover:shadow-md">
            {link.label} →
          </Card>
        </Link>
      ))}
    </div>
  );
}
