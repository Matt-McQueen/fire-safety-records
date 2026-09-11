// Signs in fresh as the admin account tests/global.setup.js created - it
// outranks every role, which is enough to create, publish and delete an
// assessment (see backend/src/domain/resources/assessments.js for who each of
// those actually requires). A fresh login rather than a saved session: see
// tests/global.setup.js for why admin has no saved session to restore.
//
// Walks the whole draft -> current -> superseded lifecycle: a draft only
// becomes "the assessment" once published, and publishing a second one for
// the same premises supersedes the first. The backend enforces real
// preconditions on publishing (SSI 2006/456 reg 9) - at least one significant
// finding and a recorded basis for the assessor's competence, since this
// premises (8 employees) is under the duty to record - so the test fills
// those in rather than working around them.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

test("a draft assessment is published, then superseded by its review", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  const today = new Date().toISOString().slice(0, 10);

  // --- first assessment: draft -> current -------------------------------

  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: fixtures.premisesName });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate; five years assessing similar premises.");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);
  const firstId = Number(page.url().match(/\/fire-risk-assessments\/(\d+)$/)[1]);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  // Publishing is refused without a significant finding while the duty to
  // record applies - add one before trying.
  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Escape route in the warehouse aisle partially obstructed by stored pallets.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Escape route in the warehouse aisle")).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();

  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  // A published assessment is no longer draft material: findings are fixed
  // and a manager can no longer delete it outright.
  await expect(page.getByRole("button", { name: "+ Add finding" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);

  // A recorded assessment may still have its review date and summary
  // updated, but nothing that reg 9 fixed at publication - editing it should
  // not offer assessor_competence again.
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Next review due")).toBeVisible();
  await expect(page.getByLabel("Summary")).toBeVisible();
  await expect(page.getByLabel("Assessor competence")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  // --- second assessment: its review supersedes the first ----------------

  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: fixtures.premisesName });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate; five years assessing similar premises.");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);
  const secondId = Number(page.url().match(/\/fire-risk-assessments\/(\d+)$/)[1]);

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Fire door to the plant room found wedged open with a fire extinguisher.");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();

  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  // No assessment already recorded for this premises is an "initial" one a
  // second time - a following assessment is a review or a revision.
  await expect(page.getByText("Review", { exact: true })).toBeVisible();

  // The first assessment is now the historical record: superseded, and
  // closed to further edits.
  await page.goto(`/fire-risk-assessments/${firstId}`);
  await expect(page.getByText("Superseded", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  // The list reflects both: one current, one superseded.
  await page.goto(`/fire-risk-assessments?premises_id=${fixtures.premisesId}`);
  const rows = page.locator("table tbody tr");
  await expect(rows.filter({ hasText: "Superseded" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Current" })).toHaveCount(1);
  expect(secondId).toBeGreaterThan(firstId);
});
