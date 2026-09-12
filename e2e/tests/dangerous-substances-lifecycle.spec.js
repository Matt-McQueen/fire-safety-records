// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/assessments.js's assertSubstanceCoherent:
// where explosive_atmosphere_likely is set, DSEAR 2002 reg 7 and sch.2 need
// the place classified into zones (hazardous_area_classification) and the
// circumstances described (explosive_atmosphere_notes) - recording the
// likelihood alone falls short of what reg 7 asks for. Marking it back to
// "not likely" lifts both requirements again.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let SUBSTANCE_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Dangerous Substances Lifecycle Premises`;
  SUBSTANCE_NAME = `[${fixtures.marker}] Test Solvent`;
});

test("an explosive atmosphere needs its zone classified and the circumstances described", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the dangerous substance.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- marking it explosive without the classification is refused ---------

  await page.goto("/records/dangerous_substances/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Name").fill(SUBSTANCE_NAME);
  await page.getByLabel("Location").fill("Solvent store, north wall");
  await page.getByRole("checkbox").nth(0).check(); // explosive_atmosphere_likely (area_marked is the second)
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(/hazardous_area_classification must record the zone \(DSEAR 2002 reg 7 and sch\.2\)/),
  ).toBeVisible();

  await page.getByLabel("Hazardous area classification").fill("Zone 2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(/explosive_atmosphere_notes must describe the circumstances in which the explosive atmosphere may occur/),
  ).toBeVisible();

  await page
    .getByLabel("Explosive atmosphere notes")
    .fill("Vapour may accumulate near the store's floor-level extraction point during decanting.");
  await page.getByLabel("Assessed on").fill(today);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/dangerous_substances");

  const row = page.locator("tbody tr").filter({ hasText: SUBSTANCE_NAME });
  await expect(row.getByText("Yes", { exact: true })).toBeVisible();

  // --- marking it back to not-likely lifts the requirement -----------------

  await row.getByRole("link", { name: SUBSTANCE_NAME }).click();
  await expect(page).toHaveURL(/\/records\/dangerous_substances\/\d+$/);
  await page.getByRole("checkbox").nth(0).uncheck(); // explosive_atmosphere_likely
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/dangerous_substances");
  await expect(row.getByText("No", { exact: true })).toBeVisible();
});
