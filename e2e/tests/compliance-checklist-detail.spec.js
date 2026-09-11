// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// compliance-dashboard.spec.js drives GET /api/premises/:id/compliance
// through the dashboard, and covers "missing" and "ok". This drives the same
// data through the Compliance tab on the premises page instead - a separate
// code path (PremisesDetailPage.tsx fetches it lazily, only once that tab is
// opened, rather than always like the dashboard does) - and covers the third
// status the dashboard test doesn't: "attention", by way of an equipment
// check whose next_due_on has already passed.
//
// A dedicated premises of its own, not the shared one tests/global.setup.js
// creates: several other spec files add records to that one, which would
// make its compliance position a moving target depending on what else the
// suite has run by the time this test reads it.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Compliance Tab Test Premises`;
});

test("the Compliance tab loads lazily, and reflects an overdue equipment check", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting the premises this creates (global-teardown.js's cleanup query)
  // cascades to everything recorded against it.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesUrl = page.url();

  // --- the checklist isn't fetched until the tab is actually opened -------

  await expect(page.getByText("No current fire risk assessment is recorded")).toHaveCount(0);
  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(
    page,
    "No current fire risk assessment is recorded, and this premises is under a duty to record one.",
    "Missing",
  );
  await expectCheck(page, "0 item(s) in service, all checks up to date.", "OK");

  // --- an overdue equipment check moves that line to "attention" ----------

  const longAgo = new Date();
  longAgo.setDate(longAgo.getDate() - 400);
  const dueLastYear = new Date();
  dueLastYear.setDate(dueLastYear.getDate() - 370);

  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: NAME });
  await page.locator("#equipment_type").selectOption("emergency_lighting");
  await page.getByLabel("Location").fill("Stairwell B");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/equipment\/\d+$/);

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Check type").fill("Annual test");
  await page.getByLabel("Performed on").fill(longAgo.toISOString().slice(0, 10));
  await page.getByLabel("Performed by (contractor)").fill("Playwright Test Fire Services");
  await page.getByLabel("Outcome").selectOption("pass");
  // Set explicitly rather than left to compute from a check schedule: this
  // premises doesn't have one, and a past due date is the whole point here.
  await page.getByLabel("Next due on").fill(dueLastYear.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Pass", { exact: true })).toBeVisible();

  // A hard reload rather than switching tabs back and forth: neither
  // creating the equipment nor recording the check invalidates
  // ["compliance", id], which is cached client-side for 15s regardless of
  // which page asks for it (see lib/queryClient.ts's staleTime).
  await page.goto(premisesUrl);
  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(page, "1 item(s) overdue a check and 0 with an unresolved defect.", "Needs attention");
});

async function expectCheck(page, summary, statusText) {
  const row = page.locator("li").filter({ hasText: summary });
  await expect(row).toBeVisible();
  await expect(row.getByText(statusText, { exact: true })).toBeVisible();
}
