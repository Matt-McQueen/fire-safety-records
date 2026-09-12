// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/premises.js's assertRoleCoherent carries three
// rules this drives through the UI: nominated_firefighting and fire_warden
// (Fire (Scotland) Act 2005 s.53(4), SSI 2006/456 reg 15) can only be held by
// an employee, not an external contractor; nominated_firefighting and
// competent_assistance both need competence_evidence recorded, since s.53(1)
// and reg 15 turn on competence rather than a bare assertion of it; and s.54
// means only one duty_holder can be active for a premises at once - a second
// appointment is refused until the first is ended.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let EMPLOYEE_NAME;
let CONTRACTOR_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Safety Roles Lifecycle Premises`;
  EMPLOYEE_NAME = `[${fixtures.marker}] Safety Roles Employee`;
  CONTRACTOR_NAME = `[${fixtures.marker}] Safety Roles Contractor`;
});

test("a nominated role needs an employee and recorded competence, and only one duty holder can be active at a time", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the safety_roles rows; the two people are cleaned up separately by their
  // own marker-tagged query, since a person is not owned by one premises.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesId = Number(page.url().match(/\/premises\/(\d+)$/)[1]);
  // The unfiltered list carries this demo's full seed data, easily over the
  // 25-row page size - every list assertion below goes through this
  // premises_id-scoped URL rather than the plain post-create redirect, or a
  // row a page further on would never be found.
  const rolesList = `/records/safety_roles?premises_id=${premisesId}`;

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(EMPLOYEE_NAME);
  await page.getByRole("checkbox").check(); // the sole boolean field, "Employee"
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(CONTRACTOR_NAME);
  // "Employee" defaults to unset (the database's own DEFAULT TRUE only
  // applies when the field is left out of the request entirely), so
  // recording this person as a non-employee needs an explicit false - check
  // then uncheck the box rather than simply never touching it.
  await page.getByRole("checkbox").check();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  // --- a fire warden must be an employee -----------------------------------

  await page.goto("/records/safety_roles/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: CONTRACTOR_NAME });
  await page.locator("#role").selectOption("fire_warden");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(/A fire warden must be an employee. Record an external adviser as competent_assistance instead/),
  ).toBeVisible();

  await page.locator("#person_id").selectOption({ label: EMPLOYEE_NAME });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/safety_roles");
  await page.goto(rolesList);
  await expect(
    page.locator("tbody tr").filter({ hasText: EMPLOYEE_NAME }).filter({ hasText: "Fire warden" }),
  ).toBeVisible();

  // --- nominated_firefighting needs competence_evidence recorded -----------

  await page.goto("/records/safety_roles/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: EMPLOYEE_NAME });
  await page.locator("#role").selectOption("nominated_firefighting");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(/competence_evidence must record the training, experience or qualification the appointment relies on/),
  ).toBeVisible();

  await page.getByLabel("Competence evidence").fill("NVQ Level 3 Fire Safety; annual refresher completed.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/safety_roles");
  await page.goto(rolesList);
  await expect(
    page.locator("tbody tr").filter({ hasText: EMPLOYEE_NAME }).filter({ hasText: "Nominated firefighting" }),
  ).toBeVisible();

  // --- s.54: only one duty holder can be active at a time ------------------

  await page.goto("/records/safety_roles/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: EMPLOYEE_NAME });
  await page.locator("#role").selectOption("duty_holder");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/safety_roles");
  await page.goto(rolesList);
  await expect(
    page.locator("tbody tr").filter({ hasText: EMPLOYEE_NAME }).filter({ hasText: "Duty holder" }),
  ).toBeVisible();

  await page.goto("/records/safety_roles/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: CONTRACTOR_NAME });
  await page.locator("#role").selectOption("duty_holder");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(/This premises already has a duty holder\. End the current appointment before recording a new one/),
  ).toBeVisible();

  // Ending the first appointment clears the way for the second.
  await page.goto(rolesList);
  await page
    .locator("tbody tr")
    .filter({ hasText: EMPLOYEE_NAME })
    .filter({ hasText: "Duty holder" })
    .getByRole("link", { name: EMPLOYEE_NAME })
    .click();
  await expect(page).toHaveURL(/\/records\/safety_roles\/\d+$/);
  await page.getByLabel("Ended on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/safety_roles");

  await page.goto("/records/safety_roles/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: CONTRACTOR_NAME });
  await page.locator("#role").selectOption("duty_holder");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/safety_roles");
  await page.goto(rolesList);
  await expect(
    page.locator("tbody tr").filter({ hasText: CONTRACTOR_NAME }).filter({ hasText: "Duty holder" }),
  ).toBeVisible();
});
