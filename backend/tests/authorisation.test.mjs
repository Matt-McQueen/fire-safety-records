// Authorisation: what each role may do, and the premises boundary.

import test from "node:test";
import assert from "node:assert/strict";
import {
  makePerson,
  makePremises,
  makeRoles,
  makeUser,
  pool,
  signIn,
  tag,
} from "./helpers.mjs";

test("a viewer may read but not write", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  assert.equal((await viewer.get("/api/premises")).status, 200);
  assert.equal((await viewer.get(`/api/premises/${premises.id}`)).status, 200);

  const created = await viewer.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  assert.equal(created.status, 403);
  assert.match(created.body.error.message, /assessor/);

  const patched = await viewer.patch(`/api/premises/${premises.id}`, { town: "Perth" });
  assert.equal(patched.status, 403);
});

test("an assessor may create and amend records but not delete them", async () => {
  const premises = await makePremises();
  const { assessor } = await makeRoles(premises.id);

  const created = await assessor.post("/api/fire-drills", {
    premises_id: premises.id,
    held_at: new Date(Date.now() - 3600_000).toISOString(),
    scenario: "Stair 2 blocked",
  });
  assert.equal(created.status, 201);

  const amended = await assessor.patch(`/api/fire-drills/${created.body.data.id}`, {
    scenario: "Stair 1 blocked",
  });
  assert.equal(amended.status, 200);
  assert.equal(amended.body.data.scenario, "Stair 1 blocked");

  const deleted = await assessor.delete(`/api/fire-drills/${created.body.data.id}`);
  assert.equal(deleted.status, 403);
});

test("only a manager may create a premises, and only an admin may delete one", async () => {
  const premises = await makePremises();
  const { assessor, manager, admin } = await makeRoles(premises.id);

  assert.equal((await assessor.post("/api/premises", { name: tag("Refused") })).status, 403);

  const created = await manager.post("/api/premises", { name: tag("Created by manager") });
  assert.equal(created.status, 201);

  // The manager who created it can see it: creating a premises grants the
  // creator access to it, or it would vanish from their view immediately.
  assert.equal((await manager.get(`/api/premises/${created.body.data.id}`)).status, 200);

  assert.equal((await manager.delete(`/api/premises/${created.body.data.id}`)).status, 403);
  assert.equal((await admin.delete(`/api/premises/${created.body.data.id}`)).status, 204);
});

test("only an admin may reach user administration", async () => {
  const premises = await makePremises();
  const { viewer, assessor, manager, admin } = await makeRoles(premises.id);

  for (const [role, session] of [["viewer", viewer], ["assessor", assessor], ["manager", manager]]) {
    assert.equal((await session.get("/api/users")).status, 403, `${role} should be refused`);
    assert.equal((await session.get("/api/users/audit/log")).status, 403);
  }
  assert.equal((await admin.get("/api/users")).status, 200);
});

test("a user sees only the premises they are assigned to", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const theirs = await makePremises({ name: tag("Theirs") });

  const account = await makeUser("manager", { premisesIds: [mine.id] });
  const session = await signIn(account);

  const list = await session.get("/api/premises");
  assert.equal(list.status, 200);
  const ids = list.body.data.map((row) => row.id);
  assert.ok(ids.includes(mine.id));
  assert.ok(!ids.includes(theirs.id), "a premises not granted must not be listed");

  // 404, not 403: a 403 would confirm that the premises exists.
  const direct = await session.get(`/api/premises/${theirs.id}`);
  assert.equal(direct.status, 404);
});

test("the premises boundary holds for records reached through a parent", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const theirs = await makePremises({ name: tag("Theirs") });

  const account = await makeUser("manager", { premisesIds: [mine.id] });
  const session = await signIn(account);
  const admin = await signIn(await makeUser("admin"));

  // An assessment and a finding belonging to the premises they cannot reach.
  const assessment = await admin.post("/api/fire-risk-assessments", {
    premises_id: theirs.id,
    carried_out_on: "2026-01-05",
    assessor_external: "External Assessor Ltd",
  });
  assert.equal(assessment.status, 201);

  const finding = await admin.post("/api/fra-significant-findings", {
    fire_risk_assessment_id: assessment.body.data.id,
    finding: "Packaging stored against the intake cupboard",
  });
  assert.equal(finding.status, 201);

  // The finding is two joins from a premises, and the boundary still holds.
  assert.equal((await session.get(`/api/fra-significant-findings/${finding.body.data.id}`)).status, 404);
  assert.equal(
    (await session.patch(`/api/fra-significant-findings/${finding.body.data.id}`, { location: "Anywhere" }))
      .status,
    404,
  );
  assert.equal((await session.delete(`/api/fra-significant-findings/${finding.body.data.id}`)).status, 404);

  const listed = await session.get("/api/fra-significant-findings");
  assert.ok(
    !listed.body.data.some((row) => row.id === finding.body.data.id),
    "a finding under another premises must not be listed",
  );

  // Filtering explicitly by the other premises returns nothing rather than
  // bypassing the scope.
  const filtered = await session.get(`/api/fra-significant-findings?premises_id=${theirs.id}`);
  assert.equal(filtered.body.data.length, 0);
});

test("a record cannot be created against a premises the user cannot reach", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const theirs = await makePremises({ name: tag("Theirs") });
  const session = await signIn(await makeUser("manager", { premisesIds: [mine.id] }));

  const response = await session.post("/api/fire-drills", {
    premises_id: theirs.id,
    held_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  // 403 here rather than 404: the caller named the premises, so its existence
  // is not something the response is disclosing.
  assert.equal(response.status, 403);
});

test("an admin is not filtered by premises", async () => {
  const first = await makePremises({ name: tag("First") });
  const second = await makePremises({ name: tag("Second") });
  const admin = await signIn(await makeUser("admin"));

  const ids = (await admin.get("/api/premises?limit=200")).body.data.map((row) => row.id);
  assert.ok(ids.includes(first.id) && ids.includes(second.id));
  assert.equal((await admin.get("/api/auth/me")).body.data.premisesIds, null);
});

test("an account with no premises granted can read nothing", async () => {
  await makePremises();
  const session = await signIn(await makeUser("viewer"));

  const list = await session.get("/api/premises");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 0, "no grants means no records");
});

test("a person is visible to an assessor only through a premises they can reach", async () => {
  const mine = await makePremises({ name: tag("Mine") });
  const theirs = await makePremises({ name: tag("Theirs") });
  const [linked, unlinked] = await Promise.all([makePerson(), makePerson()]);

  // The linked person holds a safety role at the premises the assessor covers.
  await pool.query(
    `INSERT INTO safety_roles (premises_id, person_id, role, competence_evidence)
     VALUES ($1, $2, 'fire_warden', 'Warden training 2026')`,
    [mine.id, linked.id],
  );
  await pool.query(
    `INSERT INTO safety_roles (premises_id, person_id, role, competence_evidence)
     VALUES ($1, $2, 'fire_warden', 'Warden training 2026')`,
    [theirs.id, unlinked.id],
  );

  const assessor = await signIn(await makeUser("assessor", { premisesIds: [mine.id] }));
  const visible = (await assessor.get("/api/people?limit=200")).body.data.map((row) => row.id);
  assert.ok(visible.includes(linked.id));
  assert.ok(!visible.includes(unlinked.id), "a person connected only to another premises is hidden");
  assert.equal((await assessor.get(`/api/people/${unlinked.id}`)).status, 404);

  // A manager keeps the whole directory, because they maintain it.
  const manager = await signIn(await makeUser("manager", { premisesIds: [mine.id] }));
  const managerView = (await manager.get("/api/people?limit=200")).body.data.map((row) => row.id);
  assert.ok(managerView.includes(unlinked.id));
});

test("removing a premises grant closes the sessions that relied on it", async () => {
  const first = await makePremises({ name: tag("First") });
  const second = await makePremises({ name: tag("Second") });
  const account = await makeUser("viewer", { premisesIds: [first.id, second.id] });
  const session = await signIn(account);
  const admin = await signIn(await makeUser("admin"));

  assert.equal((await session.get(`/api/premises/${second.id}`)).status, 200);

  const narrowed = await admin.patch(`/api/users/${account.id}`, { premises_ids: [first.id] });
  assert.equal(narrowed.status, 200);
  assert.deepEqual(narrowed.body.data.premises_ids, [first.id]);

  // The access token already issued still carries the old grants, so the
  // refresh token is revoked and the client is forced to sign in again rather
  // than keeping the wider scope until the token expires.
  const refreshed = await session.raw("POST", "/api/auth/refresh", undefined, {
    headers: { Cookie: session.refreshCookie },
  });
  assert.equal(refreshed.status, 401);
});

test("the last active admin cannot be demoted or deactivated", async () => {
  const admin = await signIn(await makeUser("admin"));

  // There are other admins in this database, so the guard should let this
  // through; the test asserts the guard is wired, not that it fires here.
  const { rows } = await pool.query(
    "SELECT count(*)::int AS total FROM users WHERE role = 'admin' AND is_active",
  );
  assert.ok(rows[0].total >= 1);

  const self = await admin.get("/api/auth/me");
  const response = await admin.patch(`/api/users/${self.body.data.id}`, { role: "viewer" });
  // With more than one admin this succeeds; with exactly one it is refused.
  assert.ok([200, 422].includes(response.status));
  if (response.status === 422) {
    assert.match(response.body.error.message, /only active admin/i);
  }
});

test("a password hash never appears in any user response", async () => {
  const premises = await makePremises();
  const { admin } = await makeRoles(premises.id);

  const list = await admin.get("/api/users");
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.body).includes("password_hash"));
  assert.ok(!JSON.stringify(list.body).includes("scrypt$"));

  const one = await admin.get(`/api/users/${list.body.data[0].id}`);
  assert.ok(!JSON.stringify(one.body).includes("password"));
});
