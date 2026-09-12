import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getResource, listResource } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";
import { ESCAPE_ROUTE_CHECK_FIELDS, ESCAPE_ROUTE_FIELDS, OUTCOME_LABELS } from "../../resources/equipment";
import type { Row } from "../../types/api";
import { Badge, Card, CenteredSpinner, PageHeader } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { DetailField } from "../../components/resource/DetailField";
import { ResourceEditCard } from "../../components/resource/ResourceEditCard";
import { ResourceDeleteButton } from "../../components/resource/ResourceDeleteButton";
import { CheckHistoryList } from "../../components/resource/CheckHistoryList";
import NotFoundPage from "../NotFoundPage";

const CHECKS_PATH = "/escape-route-checks";

// Already delegates its check rows to EscapeRouteCheckRow and its edit form to
// ResourceEditCard; what remains is this page's own status badges and
// editing/delete layout, which is JSX branching rather than accumulated logic.
// fallow-ignore-next-line complexity
export default function EscapeRouteDetailPage() {
  const { id } = useParams();
  const routeId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);

  const detailKey = ["resource", "escape_routes", id];
  const { data, isLoading } = useQuery({ queryKey: detailKey, queryFn: () => getResource("/escape-routes", routeId) });

  const checksKey = ["escape-route-checks", routeId];
  const checksQuery = useQuery({
    queryKey: checksKey,
    queryFn: () =>
      listResource(CHECKS_PATH, { escape_route_id: routeId, sort: "performed_on", order: "desc", limit: 100 }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    queryClient.invalidateQueries({ queryKey: checksKey });
    queryClient.invalidateQueries({ queryKey: ["resource-list", "escape_routes"] });
  };

  const canWrite = user !== null && atLeast(user.role, "assessor");
  const canDelete = user !== null && atLeast(user.role, "manager");

  if (isLoading) return <CenteredSpinner label="Loading…" />;
  if (!data) return <NotFoundPage />;

  const route = data.data;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={String(route.name)}
        breadcrumb={[{ label: "Escape routes", to: "/escape-routes" }, { label: String(route.name) }]}
        actions={canWrite && <Button onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {!route.in_service && <Badge tone="neutral">Out of service</Badge>}
        {Boolean(route.has_unresolved_obstruction) && <Badge tone="red">Obstruction outstanding</Badge>}
        {Boolean(route.check_overdue) && <Badge tone="amber">Check overdue</Badge>}
        {Boolean(route.has_emergency_lighting) && <Badge tone="blue">Emergency lighting</Badge>}
      </div>

      {editing ? (
        <ResourceEditCard
          path="/escape-routes"
          fields={ESCAPE_ROUTE_FIELDS}
          record={route}
          onDone={() => {
            setEditing(false);
            invalidate();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Card className="p-6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <DetailField label="Description" value={route.description} />
            <DetailField label="Final exit" value={route.final_exit} />
            <DetailField label="Capacity" value={route.capacity} />
            <DetailField label="Travel distance (m)" value={route.travel_distance_m} />
            <DetailField label="Signage notes" value={route.signage_notes} />
            <DetailField label="Last checked" value={route.last_checked_on} />
          </dl>
        </Card>
      )}

      {canDelete && !editing && (
        <div className="mt-3">
          <ResourceDeleteButton
            path="/escape-routes"
            id={routeId}
            confirmMessage="Delete this escape route? Refused if it has a check history."
            onDone={() => {
              invalidate();
              navigate("/escape-routes");
            }}
          />
        </div>
      )}

      <CheckHistoryList
        checks={checksQuery.data?.data}
        renderCheck={(check) => <EscapeRouteCheckRow check={check} />}
        path={CHECKS_PATH}
        fields={ESCAPE_ROUTE_CHECK_FIELDS}
        parentKey="escape_route_id"
        parentId={routeId}
        canAdd={canWrite && Boolean(route.in_service)}
        onAdded={invalidate}
      />
    </div>
  );
}

function EscapeRouteCheckRow({ check }: { check: Row }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{String(check.performed_on)}</p>
        {Boolean(check.obstructions_found) && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{String(check.obstructions_found)}</p>
        )}
        {Boolean(check.next_due_on) && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Next due: {String(check.next_due_on)}</p>
        )}
      </div>
      <Badge tone={check.outcome === "pass" ? "green" : check.obstruction_outstanding ? "red" : "amber"}>
        {OUTCOME_LABELS[String(check.outcome)] ?? String(check.outcome)}
      </Badge>
    </div>
  );
}
