// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/equipment.js's equipmentChecks.beforeCreate:
// no test or inspection interval in this domain is fixed by legislation (see
// check_schedules' own helpText in resources/configs.ts) - they come from
// Scottish Government guidance and the British Standards, configured as a
// check_schedules row. When a check is recorded with next_due_on left blank,
// findSchedule (domain/rules.js) looks one up by premises, applies_to and
// check_type and computes it from the interval - shared by equipment checks,
// escape route checks and training records alike, and exercised here for the
// first time in this suite. The same beforeCreate also refuses a check
// against equipment that isn't in service, which EquipmentDetailPage.tsx
// enforces by hiding "+ Record a check" rather than letting the refusal
// surface on submit (canAdd = canWrite && Boolean(equipment.in_service)).

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let LOCATION;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Equipment Check Schedule Lifecycle Premises`;
  LOCATION = `[${fixtures.marker}] Lobby extinguisher`;
});

test("a check left without a due date gets one from the matching schedule, and removing the equipment from service closes its check history", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);
  const intervalDays = 90;
  const expectedNextDue = new Date(`${today}T00:00:00Z`);
  expectedNextDue.setUTCDate(expectedNextDue.getUTCDate() + intervalDays);
  const expectedNextDueText = expectedNextDue.toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the schedule and the equipment.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/records/check_schedules/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Applies to").fill("equipment_type:extinguisher");
  await page.getByLabel("Check type").fill("Annual service");
  await page.getByLabel("Interval (days)").fill(String(intervalDays));
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/check_schedules");

  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#equipment_type").selectOption("extinguisher");
  await page.getByLabel("Location").fill(LOCATION);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/equipment\/\d+$/);

  // --- a check left without a due date gets one from the schedule -----------

  await page.getByRole("button", { name: "+ Record a check" }).click();
  // Must match the schedule's own check_type exactly (findSchedule looks up
  // by applies_to *and* check_type) - a different check_type would find no
  // schedule and simply leave next_due_on unset, which is also valid.
  await page.getByLabel("Check type").fill("Annual service");
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Performed by (contractor)").fill("Playwright Test Fire Services");
  await page.getByLabel("Outcome").selectOption("pass");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("button", { name: "+ Record a check" })).toBeVisible();
  await expect(page.getByText(`Next due: ${expectedNextDueText}`)).toBeVisible();

  // --- removing the equipment from service closes its check history ---------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").uncheck(); // the sole boolean field, "In service"
  await page.getByLabel("Removed on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Removed from service")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Record a check" })).toHaveCount(0);
});
