// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/procedures.js: health_safety_policies is
// another versioned document (see fire-safety-arrangements-lifecycle.spec.js
// for the shared supersede mechanism), but its own extraRules.beforeDelete
// adds one more thing - HSWA 1974 s.2(3) requires a written policy wherever a
// premises employs five or more people, so its only current policy can't
// simply be deleted; a superseded one, and a policy for a premises under five,
// carry no such restriction.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let LARGE_PREMISES_NAME;
let SMALL_PREMISES_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  LARGE_PREMISES_NAME = `[${fixtures.marker}] HS Policy Lifecycle Large Premises`;
  SMALL_PREMISES_NAME = `[${fixtures.marker}] HS Policy Lifecycle Small Premises`;
});

test("a premises with five or more employees can't have its only current policy deleted", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting these premises (global-teardown.js's cleanup query) cascades to
  // their policies.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(LARGE_PREMISES_NAME);
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const largePremisesId = Number(page.url().match(/\/premises\/(\d+)$/)[1]);

  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(SMALL_PREMISES_NAME);
  await page.getByLabel("Employee count").fill("2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const smallPremisesId = Number(page.url().match(/\/premises\/(\d+)$/)[1]);

  // --- the only current policy can't be deleted while 8 people are employed -

  await page.goto("/records/health_safety_policies/new");
  await page.locator("#premises_id").selectOption({ label: LARGE_PREMISES_NAME });
  await page.getByLabel("Statement").fill("We are committed to providing a safe working environment for all staff.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/health_safety_policies");

  await page.goto(`/records/health_safety_policies?premises_id=${largePremisesId}`);
  let rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await rows.first().locator("a").first().click();
  await expect(page).toHaveURL(/\/records\/health_safety_policies\/\d+$/);
  const firstId = Number(page.url().match(/\/records\/health_safety_policies\/(\d+)$/)[1]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByText(
      /This premises employs 8 people, so HSWA 1974 s\.2\(3\) requires a written policy\. Replace it with a new version rather than deleting it/,
    ),
  ).toBeVisible();

  // --- replacing it with a new version supersedes the first ------------------

  await page.goto("/records/health_safety_policies/new");
  await page.locator("#premises_id").selectOption({ label: LARGE_PREMISES_NAME });
  await page.getByLabel("Statement").fill("Revised policy following the annual review, reissued to all staff.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/health_safety_policies");

  await page.goto(`/records/health_safety_policies?premises_id=${largePremisesId}`);
  rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Current" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Superseded" })).toHaveCount(1);

  // --- the superseded version is kept as history, not deletable either ------

  await page.goto(`/records/health_safety_policies/${firstId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByText(/A superseded policy is the record of what was in force at the time and is kept/),
  ).toBeVisible();

  // --- a premises under five employees carries no such restriction ----------

  await page.goto("/records/health_safety_policies/new");
  await page.locator("#premises_id").selectOption({ label: SMALL_PREMISES_NAME });
  await page.getByLabel("Statement").fill("Health and safety policy for a small site.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/health_safety_policies");

  await page.goto(`/records/health_safety_policies?premises_id=${smallPremisesId}`);
  await page.locator("tbody tr").first().locator("a").first().click();
  await expect(page).toHaveURL(/\/records\/health_safety_policies\/\d+$/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/health_safety_policies");
});
