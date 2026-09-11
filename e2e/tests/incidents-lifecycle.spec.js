// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// A RIDDOR-reportable incident's own lifecycle (backend/src/domain/resources
// /incidents.js): recording one without the particulars notified to the
// enforcing authority is refused, its RIDDOR badge tracks whether a report
// is still due or has been made, and - the one hard retention rule in this
// whole domain - it can't be deleted before RIDDOR 2013 reg 12's three-year
// mark regardless of role, admin included. Contrasted at the end with an
// ordinary, non-reportable incident, which carries no such restriction.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let LOCATION;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Incidents Lifecycle Premises`;
  LOCATION = `[${fixtures.marker}] Workshop bench 3`;
});

test("a reportable incident needs its particulars to be recorded, and can't be deleted within its retention period", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the incidents, but only once the RIDDOR one no longer refuses it - see
  // the end of this test.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- marking it reportable without the particulars is refused ----------

  await page.goto("/records/incidents/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Occurred on").fill(today);
  await page.locator("#incident_type").selectOption("dangerous_occurrence");
  await page.getByLabel("Location").fill(LOCATION);
  await page.getByLabel("Description").fill("A CO2 extinguisher discharged unexpectedly while stored on the workshop bench.");
  await page.getByRole("checkbox").nth(1).check(); // riddor_reportable (fire_service_attended is the first)
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/riddor_particulars must record the particulars/)).toBeVisible();

  await page.getByLabel("RIDDOR particulars").fill(
    "Enforcing authority notified by phone of an uncontrolled discharge with no injuries; written confirmation to follow.",
  );
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/incidents");

  const row = page.locator("tbody tr").filter({ hasText: LOCATION });
  await expect(row.getByText("Report due", { exact: true })).toBeVisible();

  // --- it can't be deleted while within its RIDDOR retention period -------

  await row.getByRole("link", { name: LOCATION }).click();
  await expect(page).toHaveURL(/\/records\/incidents\/\d+$/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/reportable under RIDDOR 2013/)).toBeVisible();

  // --- reporting it updates the badge --------------------------------------

  await page.getByLabel("RIDDOR reference").fill(`${fixtures.marker}-RIDDOR-REF`);
  await page.getByLabel("RIDDOR reported on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/incidents");
  await expect(row.getByText("Reported", { exact: true })).toBeVisible();

  // --- un-marking it as reportable is refused while it still carries a ----
  // --- report - that combination doesn't mean anything -----------------

  await row.getByRole("link", { name: LOCATION }).click();
  await page.getByRole("checkbox").nth(1).uncheck(); // riddor_reportable
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/carries a report date or reference/)).toBeVisible();

  // --- an ordinary, non-reportable incident has no such restriction -------

  const otherLocation = `[${fixtures.marker}] Main corridor`;
  await page.goto("/records/incidents/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Occurred on").fill(today);
  await page.locator("#incident_type").selectOption("near_miss");
  await page.getByLabel("Location").fill(otherLocation);
  await page.getByLabel("Description").fill("A trolley was left blocking part of the corridor overnight; moved before opening.");
  await page.getByRole("button", { name: "Create" }).click();
  // The generic engine's create always returns to the list, not the new
  // record's own page (unlike premises' bespoke form).
  await expect(page).toHaveURL("/records/incidents");

  await page.getByRole("link", { name: otherLocation }).click();
  await expect(page).toHaveURL(/\/records\/incidents\/\d+$/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/incidents");
  await expect(page.getByRole("link", { name: otherLocation })).toHaveCount(0);
});
