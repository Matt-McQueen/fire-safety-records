// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/assessments.js: reg 10(1) names five things an
// arrangement records - planning, organisation, control, monitoring, review -
// so one that fills in none of them is refused. Like fire risk assessments
// and health_safety_policies, an arrangement for a measure that already has a
// current one supersedes it rather than being edited in; the superseded row
// is then kept as history and closed to further edits or deletion (unlike the
// bespoke FRA page, the generic engine doesn't hide those controls - the
// backend refuses the request when submitted instead).

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Fire Safety Arrangements Lifecycle Premises`;
});

test("an arrangement needs substance, and a new one for the same measure supersedes the last", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // both arrangements.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesId = Number(page.url().match(/\/premises\/(\d+)$/)[1]);

  // --- an arrangement recording none of the five is refused -----------------

  await page.goto("/records/fire_safety_arrangements/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#schedule2_measure_code").selectOption("a");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(
      /Fill in at least one of planning, organisation, control, monitoring or review/,
    ),
  ).toBeVisible();

  await page.getByLabel("Planning").fill("Weekly walk-round checks logged by the duty manager.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/fire_safety_arrangements");

  // --- the first version is current ------------------------------------------

  await page.goto(`/records/fire_safety_arrangements?premises_id=${premisesId}`);
  let rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByText("Current", { exact: true })).toBeVisible();

  await rows.first().locator("a").first().click();
  await expect(page).toHaveURL(/\/records\/fire_safety_arrangements\/\d+$/);
  const firstId = Number(page.url().match(/\/records\/fire_safety_arrangements\/(\d+)$/)[1]);

  // --- a second arrangement for the same measure supersedes it --------------

  await page.goto("/records/fire_safety_arrangements/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#schedule2_measure_code").selectOption("a");
  await page.getByLabel("Control").fill("Fire safety arrangements reissued after the annual review.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/fire_safety_arrangements");

  await page.goto(`/records/fire_safety_arrangements?premises_id=${premisesId}`);
  rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Current" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Superseded" })).toHaveCount(1);

  // --- the superseded version can no longer be edited or deleted ------------

  await page.goto(`/records/fire_safety_arrangements/${firstId}`);
  await page.getByLabel("Organisation").fill("Attempted edit after supersession.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(
      /This arrangement has been superseded and is kept as the historical record\. Amend the current one instead/,
    ),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/A superseded arrangement is the historical record and is kept/)).toBeVisible();
});
