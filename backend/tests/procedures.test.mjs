// Training, information to employees, cooperation between duty holders, and
// the written health and safety policy (SSI 2006/456 regs 18, 20, 21; HSWA
// 1974 s.2(3)). tests/rules.test.mjs exercises fire drills and emergency
// procedures from this same file (backend/src/domain/resources/procedures.js)
// but nothing here: these business rules had no coverage at all before this
// file.

import test from "node:test";
import assert from "node:assert/strict";
import { makePerson, makePremises, makeRoles, tag } from "./helpers.mjs";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// --- training (reg 20) -------------------------------------------------------

test("training cannot be dated in the future, and a refresher date cannot precede it", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const person = await makePerson();

  const future = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "induction",
    delivered_on: daysAhead(1),
  });
  assert.equal(future.status, 422);
  assert.match(future.body.error.message, /future/);

  const backwards = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "induction",
    delivered_on: today,
    next_due_on: daysAgo(1),
  });
  assert.equal(backwards.status, 422);
  assert.match(backwards.body.error.message, /next_due_on cannot be before delivered_on/);
});

test("training outside working hours must explain why, on both creation and amendment", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const person = await makePerson();

  const unexplained = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "induction",
    delivered_on: today,
    during_working_hours: false,
  });
  assert.equal(unexplained.status, 422);
  assert.match(unexplained.body.error.message, /content_summary must explain/);

  const explained = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "induction",
    delivered_on: today,
    during_working_hours: false,
    content_summary: "Delivered during a planned closure day at the employee's request",
  });
  assert.equal(explained.status, 201);

  // Clearing the explanation on an otherwise-fine record is refused the same
  // way on amendment.
  const clearedOnUpdate = await manager.patch(`/api/training-records/${explained.body.data.id}`, {
    content_summary: null,
  });
  assert.equal(clearedOnUpdate.status, 422);
});

test("a training record's refresher date comes from a configured schedule, like an equipment check's", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const person = await makePerson();

  const schedule = await manager.post("/api/check-schedules", {
    premises_id: premises.id,
    applies_to: "training:fire_warden",
    check_type: "training",
    interval_days: 365,
    notes: tag("Annual fire warden refresher"),
  });
  assert.equal(schedule.status, 201);

  const record = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: person.id,
    training_type: "fire_warden",
    delivered_on: daysAgo(10),
  });
  assert.equal(record.status, 201);
  assert.equal(record.body.data.next_due_on.slice(0, 10), daysAhead(355));
});

// --- information to employees (reg 21) ---------------------------------------

test("information given to employees must name a person or a group, and cannot be dated in the future", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);
  const person = await makePerson();

  const neither = await manager.post("/api/employee-information-records", {
    premises_id: premises.id,
    information_type: "risks_identified",
    provided_on: today,
  });
  assert.equal(neither.status, 400);

  const forGroup = await manager.post("/api/employee-information-records", {
    premises_id: premises.id,
    group_description: "All warehouse staff",
    information_type: "emergency_procedures",
    provided_on: today,
  });
  assert.equal(forGroup.status, 201);

  const forPerson = await manager.post("/api/employee-information-records", {
    premises_id: premises.id,
    person_id: person.id,
    information_type: "dangerous_substances",
    provided_on: daysAhead(2),
  });
  assert.equal(forPerson.status, 422);
  assert.match(forPerson.body.error.message, /future/);
});

test("amending an information record still refuses a future date", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const created = await manager.post("/api/employee-information-records", {
    premises_id: premises.id,
    group_description: "Kitchen staff",
    information_type: "preventive_measures",
    provided_on: today,
  });
  assert.equal(created.status, 201);

  const response = await manager.patch(`/api/employee-information-records/${created.body.data.id}`, {
    provided_on: daysAhead(3),
  });
  assert.equal(response.status, 422);
});

// --- cooperation between duty holders (reg 18) --------------------------------

test("a cooperation record must say what was arranged or shared, and is dated today by default", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const empty = await manager.post("/api/cooperation-records", {
    premises_id: premises.id,
    other_duty_holder: "Neighbouring unit's landlord",
  });
  assert.equal(empty.status, 422);
  assert.match(empty.body.error.message, /reg 18/);

  const withArrangements = await manager.post("/api/cooperation-records", {
    premises_id: premises.id,
    other_duty_holder: "Neighbouring unit's landlord",
    arrangements: "Shared fire alarm tested jointly every quarter",
  });
  assert.equal(withArrangements.status, 201);
  assert.equal(withArrangements.body.data.recorded_on, today);

  const withInformation = await manager.post("/api/cooperation-records", {
    premises_id: premises.id,
    other_duty_holder: "Managing agent",
    information_shared: "Location of the sprinkler valve and shared means of escape",
  });
  assert.equal(withInformation.status, 201);
});

test("a cooperation record cannot be recorded as agreed in the future", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const response = await manager.post("/api/cooperation-records", {
    premises_id: premises.id,
    other_duty_holder: "Neighbouring unit's landlord",
    arrangements: "Joint evacuation drill twice a year",
    recorded_on: daysAhead(5),
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error.message, /future/);
});

// --- the written policy, organisation-wide (HSWA 1974 s.2(3)) ----------------

test("a policy written for the whole organisation has no premises_id, and is not subject to the employee-count check when deleted", async () => {
  const { manager } = await makeRoles();

  const created = await manager.post("/api/health-safety-policies", {
    statement: tag("Organisation-wide fire safety policy statement, applying to every site."),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.premises_id, null);

  // Nothing to check against an employee count when there is no premises to
  // count them at, so this succeeds even though it is the only policy.
  const deleted = await manager.delete(`/api/health-safety-policies/${created.body.data.id}`);
  assert.equal(deleted.status, 204);
});

test("a superseded policy cannot be deleted even where the employee-count duty would not otherwise apply", async () => {
  const premises = await makePremises({ employee_count: 2 });
  const { manager } = await makeRoles(premises.id);

  const first = await manager.post("/api/health-safety-policies", {
    premises_id: premises.id,
    statement: tag("First version of the policy statement for this small premises."),
  });
  assert.equal(first.status, 201);

  const second = await manager.post("/api/health-safety-policies", {
    premises_id: premises.id,
    statement: tag("Second version, replacing the first."),
  });
  assert.equal(second.status, 201);

  const refused = await manager.delete(`/api/health-safety-policies/${first.body.data.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /superseded/);
});
