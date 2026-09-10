// The business rules. Every one of these lives in the API, and none of them can
// be reached round.

import test from "node:test";
import assert from "node:assert/strict";
import { makePerson, makePremises, makeRoles, pool, tag } from "./helpers.mjs";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// --- the duty to record ----------------------------------------------------

test("the duty to record is computed from the premises, not asserted by a client", async () => {
  const small = await makePremises({ name: tag("Small"), employee_count: 3 });
  const large = await makePremises({ name: tag("Large"), employee_count: 40 });
  const { manager } = await makeRoles(small.id);
  await grant(manager, large.id);

  const smallView = await manager.get(`/api/premises/${small.id}`);
  assert.equal(smallView.body.data.recording_duty_applies, false);

  const largeView = await manager.get(`/api/premises/${large.id}`);
  assert.equal(largeView.body.data.recording_duty_applies, true);
  assert.equal(largeView.body.data.trigger_five_or_more_employees, true);

  // Serving an alterations notice turns the duty on for the small premises,
  // without anyone editing the premises record.
  const notice = await manager.post("/api/enforcement-notices", {
    premises_id: small.id,
    notice_type: "alterations",
    served_on: daysAgo(5),
    requirements: "Notify the authority before altering the layout",
  });
  assert.equal(notice.status, 201);

  const after = await manager.get(`/api/premises/${small.id}`);
  assert.equal(after.body.data.recording_duty_applies, true);
  assert.equal(after.body.data.trigger_alterations_notice, true);
});

test("licensed premises must say which licence, because that is the trigger", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const withoutDetails = await manager.patch(`/api/premises/${premises.id}`, {
    requires_licence: true,
  });
  assert.equal(withoutDetails.status, 422);
  assert.match(withoutDetails.body.error.message, /licence_details/);

  const withDetails = await manager.patch(`/api/premises/${premises.id}`, {
    requires_licence: true,
    licence_details: "Premises licence, Licensing (Scotland) Act 2005",
  });
  assert.equal(withDetails.status, 200);
});

// --- the assessment lifecycle ----------------------------------------------

test("an assessment is created as a draft and cannot be published straight into place", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { assessor } = await makeRoles(premises.id);

  const created = await assessor.post("/api/fire-risk-assessments", {
    premises_id: premises.id,
    carried_out_on: daysAgo(3),
    assessor_external: "Competent Assessors Ltd",
    assessor_competence: "NEBOSH Fire Certificate, 12 years in the fire service",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.status, "draft");
  // The review interval is guidance, not legislation, so it is a default a
  // client may override rather than a value it must supply.
  assert.ok(created.body.data.next_review_due);

  // status is not a field a client can set.
  const forced = await assessor.patch(`/api/fire-risk-assessments/${created.body.data.id}`, {
    status: "current",
  });
  assert.equal(forced.status, 400);
});

test("an assessment must name who carried it out", async () => {
  const premises = await makePremises();
  const { assessor } = await makeRoles(premises.id);

  const response = await assessor.post("/api/fire-risk-assessments", {
    premises_id: premises.id,
    carried_out_on: daysAgo(1),
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /carried_out_by_id|assessor_external/);
});

test("an assessment cannot be dated in the future", async () => {
  const premises = await makePremises();
  const { assessor } = await makeRoles(premises.id);

  const response = await assessor.post("/api/fire-risk-assessments", {
    premises_id: premises.id,
    carried_out_on: daysAhead(7),
    assessor_external: "Competent Assessors Ltd",
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /future/);
});

test("publishing where the duty to record applies requires the significant findings", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const assessment = await draftAssessment(manager, premises.id);

  // Reg 9(1)(a): no findings recorded, so there is nothing to publish.
  const tooEarly = await manager.post(`/api/fire-risk-assessments/${assessment.id}/publish`);
  assert.equal(tooEarly.status, 422);
  assert.match(tooEarly.body.error.message, /significant finding/i);

  const finding = await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: assessment.id,
    finding: "Packaging stored against the electrical intake cupboard",
    risk_rating: "medium",
  });
  assert.equal(finding.status, 201);
  assert.equal(finding.body.data.risk_rating, "Medium");

  const published = await manager.post(`/api/fire-risk-assessments/${assessment.id}/publish`);
  assert.equal(published.status, 200);
  assert.equal(published.body.data.status, "current");
  assert.equal(published.body.data.assessment_type, "initial");
  assert.ok(published.body.data.recorded_on, "the recorded date is set when the duty applies");
});

test("publishing is refused without recorded competence where the duty applies", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const created = await manager.post("/api/fire-risk-assessments", {
    premises_id: premises.id,
    carried_out_on: daysAgo(3),
    assessor_external: "Competent Assessors Ltd",
  });
  await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: created.body.data.id,
    finding: "Escape route narrowed by additional desks",
  });

  const response = await manager.post(`/api/fire-risk-assessments/${created.body.data.id}/publish`);
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /assessor_competence/);
});

test("a premises holding dangerous substances cannot publish an assessment that ignores them", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const substance = await manager.post("/api/dangerous-substances", {
    premises_id: premises.id,
    name: "LPG cylinders",
    quantity: "6 x 19kg",
    location: "External cage",
    hazardous_properties: "Extremely flammable gas",
  });
  assert.equal(substance.status, 201);

  const assessment = await draftAssessment(manager, premises.id);
  await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: assessment.id,
    finding: "Cylinder cage adjacent to the loading door",
  });

  const refused = await manager.post(`/api/fire-risk-assessments/${assessment.id}/publish`);
  assert.equal(refused.status, 422);
  assert.match(refused.body.error.message, /covers_dangerous_substances/);

  await manager.patch(`/api/fire-risk-assessments/${assessment.id}`, {
    covers_dangerous_substances: true,
  });
  const published = await manager.post(`/api/fire-risk-assessments/${assessment.id}/publish`);
  assert.equal(published.status, 200);
});

test("publishing a second assessment supersedes the first", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const first = await publishedAssessment(manager, premises.id);
  const second = await draftAssessment(manager, premises.id);
  await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: second.id,
    finding: "Layout changed since the previous assessment",
  });

  // It follows another, so calling it an initial assessment would misdescribe
  // the history.
  const asInitial = await manager.post(`/api/fire-risk-assessments/${second.id}/publish`);
  assert.equal(asInitial.status, 422);
  assert.match(asInitial.body.error.message, /review or a revision/);

  const published = await manager.post(`/api/fire-risk-assessments/${second.id}/publish`, {
    assessment_type: "review",
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.data.supersedes_id, first.id);

  const superseded = await manager.get(`/api/fire-risk-assessments/${first.id}`);
  assert.equal(superseded.body.data.status, "superseded");

  // Exactly one current assessment per premises.
  const current = await manager.get(
    `/api/fire-risk-assessments?premises_id=${premises.id}&status=current`,
  );
  assert.equal(current.body.data.length, 1);
  assert.equal(current.body.data[0].id, second.id);
});

test("a recorded assessment cannot be rewritten, and a superseded one cannot be touched", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);
  const assessment = await publishedAssessment(manager, premises.id);

  // The narrative and the next review date remain amendable; the findings of
  // fact do not.
  assert.equal(
    (await manager.patch(`/api/fire-risk-assessments/${assessment.id}`, { summary: "Updated" }))
      .status,
    200,
  );
  const rewritten = await manager.patch(`/api/fire-risk-assessments/${assessment.id}`, {
    carried_out_on: daysAgo(1),
  });
  assert.equal(rewritten.status, 409);
  assert.match(rewritten.body.error.message, /cannot be rewritten/);

  // Nor can its findings change.
  const findings = await manager.get(
    `/api/fra-significant-findings?fire_risk_assessment_id=${assessment.id}`,
  );
  const finding = findings.body.data[0];
  const amended = await manager.patch(`/api/fra-significant-findings/${finding.id}`, {
    finding: "Something else entirely",
  });
  assert.equal(amended.status, 409);
});

test("only a draft assessment can be deleted", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const draft = await draftAssessment(manager, premises.id);
  assert.equal((await manager.delete(`/api/fire-risk-assessments/${draft.id}`)).status, 204);

  const published = await publishedAssessment(manager, premises.id);
  const refused = await manager.delete(`/api/fire-risk-assessments/${published.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /evidence/);
});

test("publishing is a manager's decision, not an assessor's", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { assessor, manager } = await makeRoles(premises.id);

  const draft = await draftAssessment(assessor, premises.id);
  await assessor.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: draft.id,
    finding: "Storage in the protected stair",
  });

  assert.equal((await assessor.post(`/api/fire-risk-assessments/${draft.id}/publish`)).status, 403);
  assert.equal((await manager.post(`/api/fire-risk-assessments/${draft.id}/publish`)).status, 200);
});

test("a young person recorded as at risk forces the assessment to say it covers them", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);
  const assessment = await draftAssessment(manager, premises.id);

  await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: assessment.id,
    finding: "Apprentices work in the workshop unsupervised at times",
  });
  const atRisk = await manager.post("/api/fra-persons-at-risk", {
    fire_risk_assessment_id: assessment.id,
    group_description: "Apprentices under 18",
    category: "young_person",
    why_at_risk: "Limited experience of the evacuation route from the workshop",
  });
  assert.equal(atRisk.status, 201);

  const refused = await manager.post(`/api/fire-risk-assessments/${assessment.id}/publish`);
  assert.equal(refused.status, 422);
  assert.match(refused.body.error.message, /covers_young_persons/);
});

test("naming a category of risk without saying why is refused", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);
  const assessment = await draftAssessment(manager, premises.id);

  const response = await manager.post("/api/fra-persons-at-risk", {
    fire_risk_assessment_id: assessment.id,
    group_description: "Visitors",
    category: "visitor",
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /why_at_risk/);

  // And a record naming neither a person nor a group is refused outright.
  const empty = await manager.post("/api/fra-persons-at-risk", {
    fire_risk_assessment_id: assessment.id,
    why_at_risk: "Unclear",
  });
  assert.equal(empty.status, 400);
});

// --- measures --------------------------------------------------------------

test("a measure's status and its dates have to agree", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);
  const assessment = await draftAssessment(manager, premises.id);
  const finding = await manager.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: assessment.id,
    finding: "Self-closer missing from the stair door",
  });
  const findingId = finding.body.data.id;

  const takenWithoutDate = await manager.post("/api/fra-measures", {
    finding_id: findingId,
    description: "Self-closer fitted",
    status: "taken",
  });
  assert.equal(takenWithoutDate.status, 422);
  assert.match(takenWithoutDate.body.error.message, /completed_on/);

  const plannedWithoutTarget = await manager.post("/api/fra-measures", {
    finding_id: findingId,
    description: "Fit a self-closer",
    status: "planned",
  });
  assert.equal(plannedWithoutTarget.status, 422);
  assert.match(plannedWithoutTarget.body.error.message, /target_date/);

  const plannedButCompleted = await manager.post("/api/fra-measures", {
    finding_id: findingId,
    description: "Fit a self-closer",
    status: "planned",
    target_date: daysAhead(30),
    completed_on: daysAgo(1),
  });
  assert.equal(plannedButCompleted.status, 422);

  const good = await manager.post("/api/fra-measures", {
    finding_id: findingId,
    description: "Fit a self-closer",
    status: "planned",
    target_date: daysAgo(10),
  });
  assert.equal(good.status, 201);
  assert.equal(good.body.data.overdue, true, "a planned measure past its target is overdue");
});

test("measures can still be progressed on a recorded assessment", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager, assessor } = await makeRoles(premises.id);
  const assessment = await publishedAssessment(manager, premises.id);

  const findings = await manager.get(
    `/api/fra-significant-findings?fire_risk_assessment_id=${assessment.id}`,
  );
  const findingId = findings.body.data[0].id;

  // A remedial action arising from a recorded assessment is the record being
  // kept up to date, not the assessment being rewritten.
  const measure = await assessor.post("/api/fra-measures", {
    finding_id: findingId,
    description: "Remove the storage and fit signage",
    status: "planned",
    target_date: daysAhead(14),
  });
  assert.equal(measure.status, 201);

  const completed = await assessor.patch(`/api/fra-measures/${measure.body.data.id}`, {
    status: "taken",
    completed_on: today,
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.overdue, false);
});

// --- equipment and checks --------------------------------------------------

test("a check's next due date comes from the configured schedule, not from a constant", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);

  const schedule = await manager.post("/api/check-schedules", {
    premises_id: premises.id,
    applies_to: "equipment_type:extinguisher",
    check_type: "visual",
    interval_days: 30,
    recommended_by: "BS 5306-3",
    notes: tag("Monthly visual"),
  });
  assert.equal(schedule.status, 201);

  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "extinguisher",
    location: "Second floor lobby",
    identifier: "EXT-01",
  });
  assert.equal(item.status, 201);

  const check = await assessor.post("/api/equipment-checks", {
    equipment_id: item.body.data.id,
    check_type: "visual",
    performed_on: daysAgo(10),
    performed_by_external: "Fire Safety Services Ltd",
    outcome: "pass",
  });
  assert.equal(check.status, 201);
  // 10 days ago plus the 30-day interval the schedule configures.
  assert.equal(check.body.data.next_due_on.slice(0, 10), daysAhead(20));
});

test("no interval is invented when no schedule covers the check", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);

  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "dry_riser",
    location: "Stair 3",
  });
  const check = await assessor.post("/api/equipment-checks", {
    equipment_id: item.body.data.id,
    check_type: "pressure_test_that_has_no_schedule",
    performed_on: daysAgo(2),
    performed_by_external: "Riser Services Ltd",
    outcome: "pass",
  });
  assert.equal(check.status, 201);
  assert.equal(check.body.data.next_due_on, null);
});

test("a failed check must say what was found, and a pass must not", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);
  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "alarm_panel",
    location: "Reception",
  });
  const equipmentId = item.body.data.id;

  const silentFailure = await assessor.post("/api/equipment-checks", {
    equipment_id: equipmentId,
    check_type: "service",
    performed_on: daysAgo(1),
    performed_by_external: "Alarms Ltd",
    outcome: "fail",
  });
  assert.equal(silentFailure.status, 422);
  assert.match(silentFailure.body.error.message, /defects_found/);

  const contradiction = await assessor.post("/api/equipment-checks", {
    equipment_id: equipmentId,
    check_type: "service",
    performed_on: daysAgo(1),
    performed_by_external: "Alarms Ltd",
    outcome: "pass",
    defects_found: "Zone 3 detector head missing",
  });
  assert.equal(contradiction.status, 422);

  const honest = await assessor.post("/api/equipment-checks", {
    equipment_id: equipmentId,
    check_type: "service",
    performed_on: daysAgo(1),
    performed_by_external: "Alarms Ltd",
    outcome: "fail",
    defects_found: "Zone 3 detector head missing",
  });
  assert.equal(honest.status, 201);
  assert.equal(honest.body.data.defect_outstanding, true);

  // The unresolved defect surfaces on the equipment itself.
  const withDefect = await assessor.get(`/api/equipment/${equipmentId}`);
  assert.equal(withDefect.body.data.has_unresolved_defect, true);
});

test("a check must record who carried it out", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);
  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "call_point",
    location: "Stair 1",
  });

  const response = await assessor.post("/api/equipment-checks", {
    equipment_id: item.body.data.id,
    check_type: "function",
    performed_on: daysAgo(1),
    outcome: "pass",
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /performed_by/);
});

test("a check cannot be recorded against equipment that is out of service", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);
  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "extinguisher",
    location: "Kitchen",
  });
  const equipmentId = item.body.data.id;

  // Taking it out of service requires saying when.
  const halfDone = await manager.patch(`/api/equipment/${equipmentId}`, { in_service: false });
  assert.equal(halfDone.status, 422);
  assert.match(halfDone.body.error.message, /removed_on/);

  const removed = await manager.patch(`/api/equipment/${equipmentId}`, {
    in_service: false,
    removed_on: daysAgo(1),
  });
  assert.equal(removed.status, 200);

  const check = await assessor.post("/api/equipment-checks", {
    equipment_id: equipmentId,
    check_type: "visual",
    performed_on: today,
    performed_by_external: "Fire Safety Services Ltd",
    outcome: "pass",
  });
  assert.equal(check.status, 409);
});

test("equipment with a check history is taken out of service, not deleted", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);
  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "fire_door",
    location: "Corridor 2",
  });
  const equipmentId = item.body.data.id;

  // With no history, deleting it is a correction and is allowed.
  const spare = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "fire_door",
    location: "Recorded in error",
  });
  assert.equal((await manager.delete(`/api/equipment/${spare.body.data.id}`)).status, 204);

  await assessor.post("/api/equipment-checks", {
    equipment_id: equipmentId,
    check_type: "visual",
    performed_on: daysAgo(5),
    performed_by_external: "Door Inspections Ltd",
    outcome: "pass",
  });

  const refused = await manager.delete(`/api/equipment/${equipmentId}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /out of service/);
});

test("a completed check is never deleted", async () => {
  const premises = await makePremises();
  const { manager, assessor } = await makeRoles(premises.id);
  const item = await manager.post("/api/equipment", {
    premises_id: premises.id,
    equipment_type: "sounder",
    location: "Second floor",
  });
  const check = await assessor.post("/api/equipment-checks", {
    equipment_id: item.body.data.id,
    check_type: "function",
    performed_on: daysAgo(3),
    performed_by_external: "Alarms Ltd",
    outcome: "pass",
  });

  const response = await manager.delete(`/api/equipment-checks/${check.body.data.id}`);
  assert.equal(response.status, 409);
  assert.match(response.body.error.message, /reg 12/);
});

test("a schedule from another premises cannot be attached to a check", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const other = await makePremises({ name: tag("Other") });
  const { manager, assessor } = await makeRoles(mine.id);
  await grant(manager, other.id);
  await grant(assessor, other.id);

  const foreignSchedule = await manager.post("/api/check-schedules", {
    premises_id: other.id,
    applies_to: "equipment_type:extinguisher",
    check_type: "visual",
    interval_days: 30,
    notes: tag("Other premises schedule"),
  });

  const item = await manager.post("/api/equipment", {
    premises_id: mine.id,
    equipment_type: "extinguisher",
    location: "Reception",
  });

  const response = await assessor.post("/api/equipment-checks", {
    equipment_id: item.body.data.id,
    check_schedule_id: foreignSchedule.body.data.id,
    check_type: "visual",
    performed_on: daysAgo(1),
    performed_by_external: "Fire Safety Services Ltd",
    outcome: "pass",
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /different premises/);
});

test("marking a check interval as statutory is refused, because none of them are", async () => {
  const premises = await makePremises();
  const { manager, admin } = await makeRoles(premises.id);

  const response = await manager.post("/api/check-schedules", {
    premises_id: premises.id,
    applies_to: "equipment_type:extinguisher",
    check_type: "service",
    interval_days: 365,
    is_statutory: true,
    recommended_by: "BS 5306-3",
    notes: tag("Claimed statutory"),
  });
  assert.equal(response.status, 403);
  assert.match(response.body.error.message, /guidance and the British Standards/);

  // An admin may, but only with a citation.
  const uncited = await admin.post("/api/check-schedules", {
    premises_id: premises.id,
    applies_to: "equipment_type:extinguisher",
    check_type: "service",
    interval_days: 365,
    is_statutory: true,
    notes: tag("No citation"),
  });
  assert.equal(uncited.status, 422);
});

// --- safety roles ----------------------------------------------------------

test("a nominated person must be an employee, with recorded competence", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const contractor = await makePerson({ is_employee: false });
  const employee = await makePerson({ is_employee: true });

  const external = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: contractor.id,
    role: "nominated_firefighting",
    competence_evidence: "Extinguisher training 2026",
  });
  assert.equal(external.status, 422);
  assert.match(external.body.error.message, /employee/);

  const noEvidence = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: employee.id,
    role: "nominated_firefighting",
  });
  assert.equal(noEvidence.status, 422);
  assert.match(noEvidence.body.error.message, /competence_evidence/);

  const good = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: employee.id,
    role: "nominated_firefighting",
    competence_evidence: "Extinguisher training, March 2026",
    appointed_on: daysAgo(30),
  });
  assert.equal(good.status, 201);
  assert.equal(good.body.data.is_active, true);
});

test("a premises has one duty holder at a time", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const [first, second] = await Promise.all([makePerson(), makePerson()]);

  const original = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: first.id,
    role: "duty_holder",
    appointed_on: daysAgo(400),
  });
  assert.equal(original.status, 201);

  const clash = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: second.id,
    role: "duty_holder",
    appointed_on: daysAgo(10),
  });
  assert.equal(clash.status, 409);

  // Ending the first appointment clears the way for the second.
  await manager.patch(`/api/safety-roles/${original.body.data.id}`, { ended_on: daysAgo(11) });
  const successor = await manager.post("/api/safety-roles", {
    premises_id: premises.id,
    person_id: second.id,
    role: "duty_holder",
    appointed_on: daysAgo(10),
  });
  assert.equal(successor.status, 201);
});

test("a person who appears in the records is closed rather than deleted", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const person = await makePerson();

  await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "induction",
    delivered_on: daysAgo(20),
  });

  const refused = await manager.delete(`/api/people/${person.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /ended_on/);

  const closed = await manager.patch(`/api/people/${person.id}`, { ended_on: today });
  assert.equal(closed.status, 200);
});

// --- drills, training, arrangements ----------------------------------------

test("a drill that found problems must record what was done", async () => {
  const premises = await makePremises();
  const { assessor } = await makeRoles(premises.id);

  const incomplete = await assessor.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() - 86_400_000).toISOString(),
    issues_identified: "Stair 2 door wedged open; two staff did not hear the sounder",
  });
  assert.equal(incomplete.status, 422);
  assert.match(incomplete.body.error.message, /actions_taken/);

  const complete = await assessor.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() - 86_400_000).toISOString(),
    issues_identified: "Stair 2 door wedged open",
    actions_taken: "Wedge removed, hold-open device ordered",
    evacuation_time_seconds: 210,
  });
  assert.equal(complete.status, 201);

  const future = await assessor.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(future.status, 422);
});

test("an arrangement must record at least one of the five things reg 10 names", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const empty = await manager.post("/api/fire-safety-arrangements", {
    premises_id: premises.id,
    schedule2_measure_code: "e",
  });
  assert.equal(empty.status, 422);
  assert.match(empty.body.error.message, /reg 10/i);

  const first = await manager.post("/api/fire-safety-arrangements", {
    premises_id: premises.id,
    schedule2_measure_code: "e",
    planning: "Alarm serviced under contract; weekly call point test by zone",
    monitoring: "Logbook reviewed monthly by the fire warden",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.is_current, true);
  assert.ok(first.body.data.recorded_on, "the recording duty applies, so recorded_on is set");

  // A replacement supersedes the previous version rather than overwriting it.
  const second = await manager.post("/api/fire-safety-arrangements", {
    premises_id: premises.id,
    schedule2_measure_code: "e",
    planning: "Alarm serviced twice yearly following the panel upgrade",
  });
  assert.equal(second.status, 201);

  const superseded = await manager.get(`/api/fire-safety-arrangements/${first.body.data.id}`);
  assert.equal(superseded.body.data.is_current, false);
  assert.equal(superseded.body.data.superseded_by_id, second.body.data.id);

  const frozen = await manager.patch(`/api/fire-safety-arrangements/${first.body.data.id}`, {
    control: "Anything",
  });
  assert.equal(frozen.status, 409);
});

test("a versioned document increments its version and supersedes the last", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const first = await manager.post("/api/emergency-procedures", {
    premises_id: premises.id,
    title: "Evacuation procedure",
    procedure: "On hearing the alarm, leave by the nearest exit and assemble in the car park.",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.version, 1);

  const second = await manager.post("/api/emergency-procedures", {
    premises_id: premises.id,
    title: "Evacuation procedure",
    procedure: "Revised after the layout change: assemble at the north gate.",
  });
  assert.equal(second.body.data.version, 2);
  assert.equal(second.body.data.is_current, true);

  const previous = await manager.get(`/api/emergency-procedures/${first.body.data.id}`);
  assert.equal(previous.body.data.is_current, false);
});

// --- incidents and enforcement ---------------------------------------------

test("a reportable incident must record the particulars, and is kept for three years", async () => {
  const premises = await makePremises();
  const { manager, admin } = await makeRoles(premises.id);

  const withoutParticulars = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAgo(20),
    incident_type: "dangerous_occurrence",
    description: "Flash fire at the LPG cage during a cylinder change",
    riddor_reportable: true,
  });
  assert.equal(withoutParticulars.status, 422);
  assert.match(withoutParticulars.body.error.message, /riddor_particulars/);

  const incident = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAgo(20),
    incident_type: "dangerous_occurrence",
    description: "Flash fire at the LPG cage during a cylinder change",
    riddor_reportable: true,
    riddor_particulars: "Dangerous occurrence, sch.2 para 9; no injuries; cage isolated",
    riddor_reported_on: daysAgo(18),
    riddor_reference: "RID-2026-0041",
  });
  assert.equal(incident.status, 201);
  assert.equal(incident.body.data.riddor_report_outstanding, false);
  assert.equal(incident.body.data.riddor_reported_late, false);
  assert.equal(incident.body.data.within_retention_period, true);
  assert.ok(incident.body.data.retain_until, "the retention date is computed by the database");

  // Reg 12: three years. Not even an admin may delete inside that period.
  const refused = await admin.delete(`/api/incidents/${incident.body.data.id}`);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /RIDDOR/);
});

test("a late RIDDOR report is recorded and flagged, not refused", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  // The record has to be able to say what actually happened.
  const incident = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAgo(60),
    incident_type: "fire",
    description: "Waste bin fire in the yard",
    riddor_reportable: true,
    riddor_particulars: "Reported late following a change of duty holder",
    riddor_reported_on: daysAgo(20),
  });
  assert.equal(incident.status, 201);
  assert.equal(incident.body.data.riddor_reported_late, true);
});

test("an incident marked not reportable cannot carry a report reference", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const response = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAgo(5),
    incident_type: "false_alarm",
    description: "Detector head triggered by steam from the kitchen",
    riddor_reference: "RID-2026-0099",
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /not reportable/);
});

test("an incident cannot be discovered before it happened, or happen in the future", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const backwards = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAgo(5),
    discovered_on: daysAgo(9),
    incident_type: "fire",
    description: "Scorching found behind the storage racking",
  });
  assert.equal(backwards.status, 422);

  const future = await manager.post("/api/incidents", {
    premises_id: premises.id,
    occurred_on: daysAhead(2),
    incident_type: "fire",
    description: "A fire that has not happened yet",
  });
  assert.equal(future.status, 422);
});

test("a notice in force is withdrawn rather than deleted", async () => {
  const premises = await makePremises();
  const { manager, admin } = await makeRoles(premises.id);

  const notice = await manager.post("/api/enforcement-notices", {
    premises_id: premises.id,
    notice_type: "enforcement",
    served_on: daysAgo(30),
    requirements: "Provide emergency lighting to the rear stair within 56 days",
  });
  assert.equal(notice.status, 201);
  assert.equal(notice.body.data.outstanding, true);

  const noticeId = notice.body.data.id;
  assert.equal((await admin.delete(`/api/enforcement-notices/${noticeId}`)).status, 409);

  // Standing down a notice has to record why.
  const unexplained = await manager.patch(`/api/enforcement-notices/${noticeId}`, {
    in_force: false,
  });
  assert.equal(unexplained.status, 422);

  const complied = await manager.patch(`/api/enforcement-notices/${noticeId}`, {
    in_force: false,
    complied_on: daysAgo(2),
    response: "Emergency lighting installed and commissioned",
  });
  assert.equal(complied.status, 200);
  assert.equal(complied.body.data.outstanding, false);
  assert.equal((await admin.delete(`/api/enforcement-notices/${noticeId}`)).status, 204);
});

test("an explosive atmosphere must be classified", async () => {
  const premises = await makePremises();
  const { assessor } = await makeRoles(premises.id);

  const unclassified = await assessor.post("/api/dangerous-substances", {
    premises_id: premises.id,
    name: "Solvent-based paint",
    location: "Spray booth",
    explosive_atmosphere_likely: true,
  });
  assert.equal(unclassified.status, 422);
  assert.match(unclassified.body.error.message, /hazardous_area_classification/);

  const classified = await assessor.post("/api/dangerous-substances", {
    premises_id: premises.id,
    name: "Solvent-based paint",
    location: "Spray booth",
    explosive_atmosphere_likely: true,
    hazardous_area_classification: "Zone 1 within the booth, Zone 2 for 1m beyond the opening",
    explosive_atmosphere_notes: "During spraying and for 10 minutes after, before extraction clears",
    area_marked: true,
  });
  assert.equal(classified.status, 201);
});

test("a written policy is required, and kept, where five or more are employed", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const policy = await manager.post("/api/health-safety-policies", {
    premises_id: premises.id,
    statement: "It is the policy of this organisation to prevent fire and to protect life.",
  });
  assert.equal(policy.status, 201);

  const refused = await manager.delete(`/api/health-safety-policies/${policy.body.data.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /s.2\(3\)/);
});

// --- the compliance view ---------------------------------------------------

test("the compliance position is computed by the API", async () => {
  const premises = await makePremises({ employee_count: 20 });
  const { manager } = await makeRoles(premises.id);

  const empty = await manager.get(`/api/premises/${premises.id}/compliance`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.data.recording_duty_applies, true);
  assert.ok(empty.body.data.caveat.includes("competent person"));

  const byKey = Object.fromEntries(empty.body.data.checks.map((check) => [check.key, check]));
  assert.equal(byKey.fire_risk_assessment.status, "missing");
  assert.equal(byKey.emergency_procedures.status, "missing");
  assert.equal(byKey.training.status, "missing");
  assert.equal(byKey.fire_drills.status, "missing");
  assert.ok(byKey.fire_risk_assessment.provision.includes("reg"));
  // The written policy is deliberately not asserted here: a policy written for
  // the organisation (premises_id NULL) covers every premises under it, so
  // whether this one is "missing" depends on what else the database holds.

  await publishedAssessment(manager, premises.id);
  await manager.post("/api/emergency-procedures", {
    premises_id: premises.id,
    title: "Evacuation procedure",
    procedure: "Leave by the nearest exit and assemble in the car park.",
  });

  const after = await manager.get(`/api/premises/${premises.id}/compliance`);
  const afterByKey = Object.fromEntries(after.body.data.checks.map((check) => [check.key, check]));
  assert.equal(afterByKey.fire_risk_assessment.status, "ok");
  assert.equal(afterByKey.emergency_procedures.status, "ok");
  assert.ok(after.body.data.summary.ok >= 2);
});

test("a small premises is told the written policy is not required", async () => {
  const premises = await makePremises({ employee_count: 3 });
  const { manager } = await makeRoles(premises.id);

  const response = await manager.get(`/api/premises/${premises.id}/compliance`);
  const byKey = Object.fromEntries(response.body.data.checks.map((check) => [check.key, check]));
  assert.equal(byKey.health_safety_policy.status, "not_required");
  assert.equal(response.body.data.recording_duty_applies, false);
});

test("the compliance view respects the premises boundary", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const theirs = await makePremises({ name: tag("Theirs") });
  const { viewer } = await makeRoles(mine.id);

  assert.equal((await viewer.get(`/api/premises/${mine.id}/compliance`)).status, 200);
  assert.equal((await viewer.get(`/api/premises/${theirs.id}/compliance`)).status, 404);
});

// --- the audit trail -------------------------------------------------------

test("every write is recorded in the audit trail", async () => {
  const premises = await makePremises();
  const { manager, admin } = await makeRoles(premises.id);

  const created = await manager.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() - 3600_000).toISOString(),
    scenario: "Original scenario",
  });
  await manager.patch(`/api/fire-drills/${created.body.data.id}`, { scenario: "Amended scenario" });

  const trail = await admin.get(
    `/api/users/audit/log?resource=fire_drills&premises_id=${premises.id}`,
  );
  assert.equal(trail.status, 200);

  const actions = trail.body.data.map((row) => row.action);
  assert.ok(actions.includes("fire_drills.create"));
  assert.ok(actions.includes("fire_drills.update"));

  const update = trail.body.data.find((row) => row.action === "fire_drills.update");
  assert.equal(update.detail.changed.scenario.from, "Original scenario");
  assert.equal(update.detail.changed.scenario.to, "Amended scenario");
  assert.ok(update.user_email, "the trail names who made the change");
});

test("a refused request is recorded as denied", async () => {
  const premises = await makePremises();
  const { viewer, admin } = await makeRoles(premises.id);

  await viewer.delete(`/api/premises/${premises.id}`);

  const trail = await admin.get("/api/users/audit/log?outcome=denied&limit=20");
  assert.ok(
    trail.body.data.some((row) => row.detail?.reason === "insufficient_role"),
    "a refusal on grounds of role should be recorded",
  );
});

// --- helpers ---------------------------------------------------------------

async function grant(session, premisesId) {
  const me = await session.get("/api/auth/me");
  await pool.query(
    `INSERT INTO user_premises (user_id, premises_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [me.body.data.id, premisesId],
  );
}

async function draftAssessment(session, premisesId) {
  const response = await session.post("/api/fire-risk-assessments", {
    premises_id: premisesId,
    carried_out_on: daysAgo(3),
    assessor_external: "Competent Assessors Ltd",
    assessor_competence: "NEBOSH Fire Certificate; 12 years in the fire service",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}

async function publishedAssessment(session, premisesId) {
  const draft = await draftAssessment(session, premisesId);
  const finding = await session.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: draft.id,
    finding: "Combustible storage in the second floor lobby",
    risk_rating: "medium",
  });
  assert.equal(finding.status, 201, JSON.stringify(finding.body));
  const published = await session.post(`/api/fire-risk-assessments/${draft.id}/publish`);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return published.body.data;
}
