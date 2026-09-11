import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFullAssessment, getResource, publishAssessment, removeResource, updateResource } from "../../lib/api";
import type { Row } from "../../types/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { ApiError } from "../../lib/http";
import {
  ASSESSMENT_TYPE_LABELS,
  FINDING_FIELDS,
  FRA_CURRENT_FIELDS,
  FRA_DRAFT_EDIT_FIELDS,
  MEASURE_FIELDS,
  PERSON_AT_RISK_FIELDS,
} from "../../resources/fra";
import { Badge, Card, CenteredSpinner, PageHeader, ApiErrorAlert } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ResourceForm } from "../../components/resource/ResourceForm";
import type { FormValues } from "../../components/resource/ResourceForm";
import { ChildRecordForm } from "../../components/resource/ChildRecordForm";
import NotFoundPage from "../NotFoundPage";

const FINDINGS_PATH = "/fra-significant-findings";
const MEASURES_PATH = "/fra-measures";
const PERSONS_AT_RISK_PATH = "/fra-persons-at-risk";

export default function FraDetailPage() {
  const { id } = useParams();
  const assessmentId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const queryKey = ["fra-full", assessmentId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchFullAssessment(assessmentId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["resource-list", "fire_risk_assessments"] });
  };

  if (isLoading) return <CenteredSpinner label="Loading…" />;
  if (error) return <ApiErrorAlert error={error} />;
  if (!data) return <NotFoundPage />;

  const fra = data.data;
  const canWrite = user !== null && atLeast(user.role, "assessor");
  const canPublish = user !== null && atLeast(user.role, "manager") && fra.status === "draft";
  const canDelete = user !== null && atLeast(user.role, "manager") && fra.status === "draft";
  const isDraft = fra.status === "draft";
  const isSuperseded = fra.status === "superseded";

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Assessment ${fra.reference ? `— ${fra.reference}` : `#${fra.id}`}`}
        breadcrumb={[
          { label: "Fire risk assessments", to: "/fire-risk-assessments" },
          { label: fra.reference ? String(fra.reference) : `#${fra.id}` },
        ]}
        actions={
          <>
            {canWrite && !isSuperseded && (
              <Button onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>
            )}
            {canPublish && (
              <Button variant="primary" onClick={() => setPublishing(true)}>
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge fra={fra} />
        <Badge tone="neutral">{ASSESSMENT_TYPE_LABELS[String(fra.assessment_type)] ?? String(fra.assessment_type)}</Badge>
        <a className="text-sm text-slate-500 hover:underline" href={`/premises/${fra.premises_id}`} onClick={(e) => { e.preventDefault(); navigate(`/premises/${fra.premises_id}`); }}>
          {String(fra.premises_name)}
        </a>
      </div>

      {publishing && (
        <PublishDialog
          assessmentId={assessmentId}
          currentType={String(fra.assessment_type)}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            invalidate();
          }}
        />
      )}

      {editing ? (
        <EditAssessmentCard
          fra={fra}
          fields={isDraft ? FRA_DRAFT_EDIT_FIELDS : FRA_CURRENT_FIELDS}
          onDone={() => {
            setEditing(false);
            invalidate();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <OverviewCard fra={fra} />
      )}

      {canDelete && !editing && (
        <div className="mt-3">
          <DeleteAssessmentButton
            assessmentId={assessmentId}
            onDone={() => {
              invalidate();
              navigate("/fire-risk-assessments");
            }}
          />
        </div>
      )}

      <Section title="Significant findings" className="mt-6">
        <FindingsList
          assessmentId={assessmentId}
          findings={data.data.significant_findings}
          canEditFindings={canWrite && isDraft}
          canEditMeasures={canWrite && !isSuperseded}
          onChange={invalidate}
        />
      </Section>

      <Section title="Persons at particular risk" className="mt-6">
        <PersonsAtRiskList
          assessmentId={assessmentId}
          persons={data.data.persons_at_risk}
          canEdit={canWrite && isDraft}
          onChange={invalidate}
        />
      </Section>
    </div>
  );
}

function StatusBadge({ fra }: { fra: Row }) {
  if (fra.status === "draft") return <Badge tone="blue">Draft</Badge>;
  if (fra.status === "current")
    return fra.review_overdue ? <Badge tone="amber">Current — review overdue</Badge> : <Badge tone="green">Current</Badge>;
  return <Badge tone="neutral">Superseded</Badge>;
}

function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {children}
    </div>
  );
}

function OverviewCard({ fra }: { fra: Row }) {
  const carriedOutById = fra.carried_out_by_id as number | null;
  const { data: carriedOutBy } = useQuery({
    queryKey: ["resource", "people", carriedOutById],
    queryFn: () => getResource("/people", carriedOutById!),
    enabled: carriedOutById !== null && carriedOutById !== undefined,
  });

  const rows: [string, unknown][] = [
    ["Carried out on", fra.carried_out_on],
    ["Recorded on", fra.recorded_on ?? "—"],
    ["Next review due", fra.next_review_due ?? "—"],
    ["Carried out by (internal)", carriedOutById ? (carriedOutBy?.data.full_name ?? "…") : "—"],
    ["External assessor", fra.assessor_external ?? "—"],
    ["Assessor competence", fra.assessor_competence ?? "—"],
    ["Covers young persons", fra.covers_young_persons ? "Yes" : "No"],
    ["Covers dangerous substances", fra.covers_dangerous_substances ? "Yes" : "No"],
  ];
  return (
    <Card className="p-6">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="text-sm text-slate-800">{String(value)}</dd>
          </div>
        ))}
      </dl>
      {Boolean(fra.summary) && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <dt className="text-xs font-medium text-slate-500">Summary</dt>
          <dd className="mt-1 text-sm whitespace-pre-wrap text-slate-800">{String(fra.summary)}</dd>
        </div>
      )}
    </Card>
  );
}

function EditAssessmentCard({
  fra,
  fields,
  onDone,
  onCancel,
}: {
  fra: Row;
  fields: typeof FRA_CURRENT_FIELDS;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(fra);
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body: FormValues = {};
      for (const field of fields) {
        if (values[field.key] !== fra[field.key]) body[field.key] = values[field.key] ?? null;
      }
      return updateResource("/fire-risk-assessments", fra.id as number, body);
    },
    onSuccess: onDone,
    onError: setError,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  return (
    <Card className="p-6">
      {Boolean(error) && (
        <div className="mb-4">
          <ApiErrorAlert error={error} />
        </div>
      )}
      <ResourceForm
        fields={fields}
        mode="update"
        values={values}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        fieldErrors={fieldErrors}
      />
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}

function DeleteAssessmentButton({ assessmentId, onDone }: { assessmentId: number; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: () => removeResource("/fire-risk-assessments", assessmentId),
    onSuccess: onDone,
    onError: setError,
  });
  return (
    <div>
      {Boolean(error) && <ApiErrorAlert error={error} />}
      <Button
        variant="danger"
        loading={mutation.isPending}
        onClick={() => {
          if (confirm("Delete this draft assessment?")) mutation.mutate();
        }}
      >
        Delete draft
      </Button>
    </div>
  );
}

function PublishDialog({
  assessmentId,
  currentType,
  onClose,
  onDone,
}: {
  assessmentId: number;
  currentType: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [recordedOn, setRecordedOn] = useState("");
  const [assessmentType, setAssessmentType] = useState(currentType === "initial" ? "review" : currentType);
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: () =>
      publishAssessment(assessmentId, {
        recorded_on: recordedOn || undefined,
        assessment_type: assessmentType as "review" | "revision_after_change",
      }),
    onSuccess: onDone,
    onError: setError,
  });

  return (
    <Card className="mb-4 p-4">
      <p className="mb-3 text-sm text-slate-600">
        Publishing makes this the recorded assessment for its premises and supersedes any assessment currently
        recorded there.
      </p>
      {Boolean(error) && (
        <div className="mb-3">
          <ApiErrorAlert error={error} />
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Recorded on (defaults to today)</label>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={recordedOn}
            onChange={(e) => setRecordedOn(e.target.value)}
          />
        </div>
        {currentType !== "initial" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Assessment type</label>
            <select
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              value={assessmentType}
              onChange={(e) => setAssessmentType(e.target.value)}
            >
              <option value="review">Review</option>
              <option value="revision_after_change">Revision after change</option>
            </select>
          </div>
        )}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Confirm publish
        </Button>
      </div>
    </Card>
  );
}

// --- findings & measures ----------------------------------------------------

function FindingsList({
  assessmentId,
  findings,
  canEditFindings,
  canEditMeasures,
  onChange,
}: {
  assessmentId: number;
  findings: (Row & { measures: Row[] })[];
  canEditFindings: boolean;
  canEditMeasures: boolean;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <FindingCard
          key={String(finding.id)}
          finding={finding}
          canEdit={canEditFindings}
          canEditMeasures={canEditMeasures}
          onChange={onChange}
        />
      ))}

      {findings.length === 0 && <p className="text-sm text-slate-500">No significant findings recorded yet.</p>}

      {canEditFindings && (
        <div>
          {adding ? (
            <ChildRecordForm
              path={FINDINGS_PATH}
              fields={FINDING_FIELDS}
              parentKey="fire_risk_assessment_id"
              parentId={assessmentId}
              onDone={() => {
                setAdding(false);
                onChange();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button size="sm" onClick={() => setAdding(true)}>
              + Add finding
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  canEdit,
  canEditMeasures,
  onChange,
}: {
  finding: Row & { measures: Row[] };
  canEdit: boolean;
  canEditMeasures: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingMeasure, setAddingMeasure] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const removeMutation = useMutation({
    mutationFn: () => removeResource(FINDINGS_PATH, finding.id as number),
    onSuccess: onChange,
    onError: setError,
  });

  return (
    <Card className="p-4">
      {Boolean(error) && (
        <div className="mb-2">
          <ApiErrorAlert error={error} />
        </div>
      )}
      {editing ? (
        <ChildRecordForm
          path={FINDINGS_PATH}
          fields={FINDING_FIELDS}
          initialValues={finding}
          recordId={finding.id as number}
          onDone={() => {
            setEditing(false);
            onChange();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-800">{String(finding.finding)}</p>
            {finding.risk_rating ? <Badge tone={riskTone(String(finding.risk_rating))}>{String(finding.risk_rating)}</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            {finding.location ? <span>Location: {String(finding.location)}</span> : null}
            {finding.ignition_source ? <span>Ignition: {String(finding.ignition_source)}</span> : null}
            {finding.fuel_source ? <span>Fuel: {String(finding.fuel_source)}</span> : null}
          </div>
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={removeMutation.isPending}
                onClick={() => {
                  if (confirm("Delete this finding?")) removeMutation.mutate();
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </>
      )}

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 pl-3">
        {finding.measures.map((measure) => (
          <MeasureRow key={String(measure.id)} measure={measure} canEdit={canEditMeasures} onChange={onChange} />
        ))}
        {finding.measures.length === 0 && <p className="text-xs text-slate-400">No measures recorded.</p>}
        {canEditMeasures &&
          (addingMeasure ? (
            <ChildRecordForm
              path={MEASURES_PATH}
              fields={MEASURE_FIELDS}
              parentKey="finding_id"
              parentId={finding.id as number}
              onDone={() => {
                setAddingMeasure(false);
                onChange();
              }}
              onCancel={() => setAddingMeasure(false)}
            />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAddingMeasure(true)}>
              + Add measure
            </Button>
          ))}
      </div>
    </Card>
  );
}

function riskTone(rating: string): "red" | "amber" | "green" | "neutral" {
  if (rating === "High") return "red";
  if (rating === "Medium") return "amber";
  if (rating === "Low") return "green";
  return "neutral";
}

function MeasureRow({ measure, canEdit, onChange }: { measure: Row; canEdit: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const removeMutation = useMutation({
    mutationFn: () => removeResource(MEASURES_PATH, measure.id as number),
    onSuccess: onChange,
    onError: setError,
  });

  if (editing) {
    return (
      <ChildRecordForm
        path={MEASURES_PATH}
        fields={MEASURE_FIELDS}
        initialValues={measure}
        recordId={measure.id as number}
        onDone={() => {
          setEditing(false);
          onChange();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="text-sm">
      {Boolean(error) && <ApiErrorAlert error={error} />}
      <div className="flex items-start justify-between gap-3">
        <p className="text-slate-700">{String(measure.description)}</p>
        <Badge tone={measure.status === "taken" ? "green" : measure.overdue ? "red" : "amber"}>
          {measure.status === "taken" ? "Taken" : measure.overdue ? "Planned — overdue" : "Planned"}
        </Badge>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
        {measure.target_date ? <span>Target: {String(measure.target_date)}</span> : null}
        {measure.completed_on ? <span>Completed: {String(measure.completed_on)}</span> : null}
      </div>
      {canEdit && (
        <div className="mt-1 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={removeMutation.isPending}
            onClick={() => {
              if (confirm("Delete this measure?")) removeMutation.mutate();
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

// --- persons at risk ---------------------------------------------------------

function PersonsAtRiskList({
  assessmentId,
  persons,
  canEdit,
  onChange,
}: {
  assessmentId: number;
  persons: Row[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      {persons.map((person) => (
        <PersonAtRiskRow key={String(person.id)} person={person} canEdit={canEdit} onChange={onChange} />
      ))}
      {persons.length === 0 && <p className="text-sm text-slate-500">No persons at particular risk recorded.</p>}
      {canEdit && (
        <div>
          {adding ? (
            <ChildRecordForm
              path={PERSONS_AT_RISK_PATH}
              fields={PERSON_AT_RISK_FIELDS}
              parentKey="fire_risk_assessment_id"
              parentId={assessmentId}
              onDone={() => {
                setAdding(false);
                onChange();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button size="sm" onClick={() => setAdding(true)}>
              + Add person or group
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PersonAtRiskRow({ person, canEdit, onChange }: { person: Row; canEdit: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const removeMutation = useMutation({
    mutationFn: () => removeResource(PERSONS_AT_RISK_PATH, person.id as number),
    onSuccess: onChange,
    onError: setError,
  });

  if (editing) {
    return (
      <Card className="p-4">
        <ChildRecordForm
          path={PERSONS_AT_RISK_PATH}
          fields={PERSON_AT_RISK_FIELDS}
          initialValues={person}
          recordId={person.id as number}
          onDone={() => {
            setEditing(false);
            onChange();
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card className="p-4">
      {Boolean(error) && <ApiErrorAlert error={error} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {person.person_name ? String(person.person_name) : String(person.group_description ?? "Unnamed")}
          </p>
          {person.category ? <p className="text-xs text-slate-500">{String(person.category)}</p> : null}
          {person.why_at_risk ? <p className="mt-1 text-sm text-slate-700">{String(person.why_at_risk)}</p> : null}
        </div>
        {person.peep_in_place ? <Badge tone="blue">PEEP in place</Badge> : null}
      </div>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={removeMutation.isPending}
            onClick={() => {
              if (confirm("Delete this entry?")) removeMutation.mutate();
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </Card>
  );
}

