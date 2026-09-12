// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/equipment.js's assertScheduleHonest has two
// halves: audit-log.spec.js already covers the role half (only an admin may
// mark a schedule statutory at all). This covers the other half, which
// applies even to the admin who is allowed to do it - no interval or
// inspection frequency in this domain is fixed by legislation, so marking one
// statutory still needs recommended_by to cite what actually fixes it.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let APPLIES_TO;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Check Schedules Lifecycle Premises`;
  APPLIES_TO = `equipment_type:extinguisher (${fixtures.marker})`;
});

test("marking a schedule statutory needs a citation, even for the admin allowed to do it", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the schedule.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- an ordinary, non-statutory schedule needs no citation ----------------

  await page.goto("/records/check_schedules/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Applies to").fill(APPLIES_TO);
  await page.getByLabel("Check type").fill("Annual service");
  await page.getByLabel("Interval (days)").fill("365");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/check_schedules");

  const row = page.locator("tbody tr").filter({ hasText: APPLIES_TO });
  await expect(row.getByText("No", { exact: true })).toBeVisible();

  // --- marking it statutory without a citation is refused --------------------

  await row.getByRole("link", { name: APPLIES_TO }).click();
  await expect(page).toHaveURL(/\/records\/check_schedules\/\d+$/);
  await page.getByRole("checkbox").check(); // the sole boolean field, "Statutory"
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(/recommended_by must cite the provision that fixes the interval when is_statutory is set/),
  ).toBeVisible();

  // --- a citation is enough -----------------------------------------------

  await page.getByLabel("Recommended by").fill("BS 5306-3");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/check_schedules");
  await expect(row.getByText("Yes", { exact: true })).toBeVisible();

  // --- and it can be deleted like any other schedule -------------------------

  await row.getByRole("link", { name: APPLIES_TO }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/check_schedules");
  await expect(page.getByRole("link", { name: APPLIES_TO })).toHaveCount(0);
});
