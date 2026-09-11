// Input handling: what the API accepts, what it rejects, and what it refuses to
// be talked into.

import test from "node:test";
import assert from "node:assert/strict";
import { anonymous, makePremises, makeRoles, tag } from "./helpers.mjs";

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("an unrecognised field in the body is rejected rather than dropped", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const response = await manager.post("/api/premises", {
    name: tag("Strict"),
    // A client that misspells a field should be told, not left with a record
    // that quietly lacks it.
    twon: "Glasgow",
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "bad_request");
  assert.ok(response.body.error.details.fields.some((field) => /twon/.test(field.message)));
});

test("a field cannot be set to something the column will not hold", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const cases = [
    [{ name: "" }, "an empty name"],
    [{ name: tag("X"), employee_count: -1 }, "a negative employee count"],
    [{ name: tag("X"), postcode: "not a postcode" }, "a malformed postcode"],
    [{ name: tag("X"), enforcing_authority: "The Council" }, "an authority that does not enforce"],
    [{ name: tag("X"), employee_count: "twelve" }, "a non-numeric count"],
  ];

  for (const [body, description] of cases) {
    const response = await manager.post("/api/premises", body);
    assert.equal(response.status, 400, `${description} should be refused`);
  }
});

test("a postcode is normalised, and text is trimmed", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const response = await manager.post("/api/premises", {
    name: `  ${tag("Trimmed")}  `,
    postcode: "g26jd",
    town: "  Glasgow  ",
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.postcode, "G2 6JD");
  assert.equal(response.body.data.town, "Glasgow");
  assert.equal(response.body.data.name, tag("Trimmed"));
});

test("an unknown query parameter is rejected, so a bad filter cannot widen a result", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  // A typo in a filter would otherwise be ignored and return everything.
  assert.equal((await viewer.get("/api/equipment?equipment_typ=extinguisher")).status, 400);
  assert.equal((await viewer.get("/api/incidents?riddor=true")).status, 400);
  assert.equal((await viewer.get("/api/premises?limit=999")).status, 400);
  assert.equal((await viewer.get("/api/premises?limit=0")).status, 400);
});

test("sorting is restricted to the columns the resource declares", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  assert.equal((await viewer.get("/api/premises?sort=name&order=asc")).status, 200);
  assert.equal((await viewer.get("/api/premises?sort=notes")).status, 400);
  assert.equal((await viewer.get("/api/premises?order=sideways")).status, 400);
});

test("SQL is never assembled from a request", async () => {
  const premises = await makePremises({ name: tag("Injection target") });
  const { manager } = await makeRoles(premises.id);

  const attempts = [
    "/api/premises?sort=name; DROP TABLE premises--",
    "/api/premises?q=%27%20OR%201%3D1--",
    "/api/premises?town=%27%3B%20DELETE%20FROM%20premises%3B--",
    "/api/equipment?equipment_type=extinguisher%27%20OR%20%271%27%3D%271",
  ];
  for (const path of attempts) {
    const response = await manager.get(path);
    // Either rejected by the schema or treated as a literal value. Never
    // executed, and never a 500.
    assert.ok([200, 400].includes(response.status), `${path} gave ${response.status}`);
  }

  // The table is still there and the row is still in it.
  const check = await manager.get(`/api/premises/${premises.id}`);
  assert.equal(check.status, 200);
  assert.equal(check.body.data.name, tag("Injection target"));
});

test("a wildcard in a search term matches literally", async () => {
  const withPercent = await makePremises({ name: tag("Percent 100% test") });
  const withoutPercent = await makePremises({ name: tag("Plain name") });
  const { manager } = await makeRoles(withPercent.id);

  // Unescaped, '%' would reach LIKE as a wildcard and match every row. Escaped,
  // it matches only the name that actually contains one.
  const searched = await manager.get("/api/premises?q=%25&limit=200");
  assert.equal(searched.status, 200);
  const ids = searched.body.data.map((row) => row.id);
  assert.ok(ids.includes(withPercent.id), "the name containing a percent sign should match");
  assert.ok(!ids.includes(withoutPercent.id), "a bare wildcard must not match everything");

  // '_' is the other LIKE wildcard, and matches any single character unescaped.
  const underscore = await manager.get("/api/premises?q=_&limit=200");
  assert.equal(underscore.body.data.length, 0);
});

test("a malformed body and an oversized body are refused", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const malformed = await manager.raw("POST", "/api/premises", undefined, {
    headers: { "Content-Type": "application/json" },
  });
  // No body at all fails validation; a broken one fails to parse. Both are 400.
  assert.equal(malformed.status, 400);

  const huge = await manager.post("/api/premises", {
    name: tag("Huge"),
    notes: "x".repeat(500_000),
  });
  assert.ok([400, 413].includes(huge.status), `expected a refusal, got ${huge.status}`);
});

test("an empty PATCH is reported rather than silently succeeding", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  const response = await manager.patch(`/api/premises/${premises.id}`, {});
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /No fields/i);
});

test("a non-numeric id is a 400, and a missing one a 404", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  assert.equal((await viewer.get("/api/premises/not-a-number")).status, 400);
  assert.equal((await viewer.get("/api/premises/0")).status, 400);
  assert.equal((await viewer.get("/api/premises/999999999")).status, 404);
});

test("an internal error never leaks the database or a stack to the client", async () => {
  const premises = await makePremises();
  const { manager } = await makeRoles(premises.id);

  // A foreign key that does not exist: the database refuses it, and the client
  // gets a considered answer rather than the constraint's own words.
  const response = await manager.post("/api/training-records", {
    premises_id: premises.id,
    person_id: 999_999_999,
    training_type: "induction",
    delivered_on: yesterday,
  });
  assert.ok([404, 409].includes(response.status));
  const text = JSON.stringify(response.body);
  assert.ok(!/postgres|pg_|relation|SELECT|INSERT/i.test(text), text);
});

test("every response carries a request id for tracing", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  const ok = await viewer.get("/api/premises");
  assert.ok(ok.headers.get("x-request-id"));

  const refused = await viewer.get("/api/premises/999999999");
  assert.equal(refused.body.error.requestId, refused.headers.get("x-request-id"));
});

test("responses set the headers that stop a JSON body being treated as a document", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);
  const response = await viewer.get("/api/premises");

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

test("the machine-readable index lists every resource, requires a token like anything else, and needs none of a client's own knowledge to use", async () => {
  const premises = await makePremises();
  const { viewer } = await makeRoles(premises.id);

  assert.equal((await anonymous.get("/api/")).status, 401);

  const response = await viewer.get("/api/");
  assert.equal(response.status, 200);
  const { resources, extra } = response.body.data;

  assert.ok(resources.length >= 20, "every table in the schema should be represented");
  const premisesEntry = resources.find((entry) => entry.name === "premises");
  assert.equal(premisesEntry.path, "/api/premises");
  assert.deepEqual(premisesEntry.operations, ["list", "get", "create", "update", "remove"]);
  assert.equal(premisesEntry.permissions.read, "viewer");
  assert.ok(Array.isArray(premisesEntry.sortable) && premisesEntry.sortable.length > 0);

  // The hand-written endpoints that are not one of the generic five, listed
  // separately because there is no resource definition to derive them from.
  const extraPaths = extra.map((entry) => entry.path);
  assert.ok(extraPaths.includes("/api/premises/:id/compliance"));
  assert.ok(extraPaths.includes("/api/fire-risk-assessments/:id/publish"));
});

test("pagination reports the total and honours limit and offset", async () => {
  const premises = await makePremises();
  const { assessor, viewer } = await makeRoles(premises.id);

  for (let index = 0; index < 3; index += 1) {
    const response = await assessor.post("/api/fire-drills", {
      premises_id: premises.id,
      held_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
      scenario: `Drill ${index}`,
    });
    assert.equal(response.status, 201);
  }

  const firstPage = await viewer.get(`/api/fire-drills?premises_id=${premises.id}&limit=2`);
  assert.equal(firstPage.body.data.length, 2);
  assert.equal(firstPage.body.page.total, 3);

  const secondPage = await viewer.get(
    `/api/fire-drills?premises_id=${premises.id}&limit=2&offset=2`,
  );
  assert.equal(secondPage.body.data.length, 1);
  assert.equal(secondPage.body.page.total, 3);
});
