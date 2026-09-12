// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/procedures.js: reg 21 requires information to
// be given to employees, either individually or as a group, so the create
// schema's z.strictObject(...).refine(...) needs either person_id or
// group_description - a record naming neither identifies nobody. Also checks
// the plain notInFuture(provided_on) rule shared with the rest of this
// domain's "record of something that happened" resources.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let PERSON_NAME;
let GROUP_DESCRIPTION;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Employee Information Lifecycle Premises`;
  PERSON_NAME = `[${fixtures.marker}] Info Record Person`;
  GROUP_DESCRIPTION = `[${fixtures.marker}] Warehouse shift staff`;
});

test("a record needs either a person or a group description, and can't be dated in the future", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // both records; the person is cleaned up separately by its own
  // marker-tagged query, since a person is not owned by one premises.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(PERSON_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  // --- neither a person nor a group description is refused ------------------

  await page.goto("/records/employee_information_records/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#information_type").selectOption("risks_identified");
  await page.getByLabel("Provided on").fill(today);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/Give either person_id for one employee, or group_description for a group/)).toBeVisible();

  // --- a future date is refused too, independent of that rule ----------------

  await page.getByLabel("Group description").fill(GROUP_DESCRIPTION);
  await page.getByLabel("Provided on").fill(tomorrow);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/provided_on cannot be in the future/)).toBeVisible();

  // --- a group description alone is enough ------------------------------------

  await page.getByLabel("Provided on").fill(today);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/employee_information_records");
  const groupRow = page.locator("tbody tr").filter({ hasText: GROUP_DESCRIPTION });
  await expect(groupRow).toBeVisible();

  // --- and so is a named person, with no group description at all ------------

  await page.goto("/records/employee_information_records/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: PERSON_NAME });
  await page.locator("#information_type").selectOption("dangerous_substances");
  await page.getByLabel("Provided on").fill(today);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/employee_information_records");
  await expect(page.locator("tbody tr").filter({ hasText: PERSON_NAME })).toBeVisible();
});
