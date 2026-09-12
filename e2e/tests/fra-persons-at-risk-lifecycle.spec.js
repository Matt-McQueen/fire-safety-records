// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/assessments.js's assertPeepCoherent, on
// fra_persons_at_risk: reg 9(1)(b) records the groups especially at risk, so
// a category set without why_at_risk records the label rather than the
// finding, and a personal emergency evacuation plan marked in place needs its
// own reference. Like a significant finding (and unlike a measure - see
// fra-measures-lifecycle.spec.js), this is locked once the assessment is
// published: FraDetailPage.tsx's canEdit for this section is
// canWrite && isDraft, so "+ Add person or group" disappears entirely rather
// than being refused on submit.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let PERSON_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] FRA Persons At Risk Lifecycle Premises`;
  PERSON_NAME = `[${fixtures.marker}] FRA Persons At Risk Named Person`;
});

test("a person or group at risk needs to say why, a PEEP needs its reference, and both lock once published", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // 8 employees puts this premises under the duty to record, which is what
  // makes at least one finding and a recorded assessor competence
  // preconditions of publishing below.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(PERSON_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate; five years assessing similar premises.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Storage room door lock does not disengage from the inside.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The toggle reappearing is the unambiguous signal that the create
  // succeeded and its form closed - waiting on the finding's own text can
  // otherwise match the still-open textarea's typed value instead of a real,
  // saved row.
  await expect(page.getByRole("button", { name: "+ Add finding" })).toBeVisible();
  await expect(page.getByText("Storage room door lock")).toBeVisible();

  // --- neither a named person nor a group description is refused ------------

  await page.getByRole("button", { name: "+ Add person or group" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(/Give either person_id for a named individual, or group_description for a group/),
  ).toBeVisible();

  // --- a category needs to say why the group is at risk -----------------------

  await page.getByLabel("Group description").fill("Overnight cleaning contractors");
  await page.locator("#category").selectOption("contractor");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(/why_at_risk must say why this person or group is especially at risk, which is what reg 9\(1\)\(b\) records/),
  ).toBeVisible();

  await page.getByLabel("Why at risk").fill("Work alone overnight with limited familiarity with the escape routes.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add person or group" })).toBeVisible();
  await expect(page.getByText("Overnight cleaning contractors")).toBeVisible();

  // --- a PEEP marked in place needs its own reference --------------------------

  await page.getByRole("button", { name: "+ Add person or group" }).click();
  await page.locator("#person_id").selectOption({ label: PERSON_NAME });
  await page.locator("#category").selectOption("mobility_impaired");
  await page.getByLabel("Why at risk").fill("Uses a wheelchair; cannot use the stairwell unassisted.");
  await page.getByRole("checkbox").check(); // the sole boolean field, "PEEP in place"
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(/peep_reference must identify the personal emergency evacuation plan when peep_in_place is set/),
  ).toBeVisible();

  await page.getByLabel("PEEP reference").fill("PEEP-2024-014");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add person or group" })).toBeVisible();
  await expect(page.getByText("PEEP in place")).toBeVisible();

  // --- publishing locks this section, the same as findings --------------------

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "+ Add finding" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add person or group" })).toHaveCount(0);
});
