// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// GET /api/premises/:id/compliance (backend/src/domain/compliance.js) is
// where most of this app's actual value is: no client works out for itself
// whether a review is overdue or a written policy is missing. This drives it
// through the dashboard rather than the Compliance tab on the premises page,
// since the dashboard is also where the account's premises picker and the
// OK/attention/missing summary live.
//
// A brand new premises of its own, not the shared one tests/global.setup.js
// creates: several other spec files add records to that one, which would
// make its compliance position a moving target depending on what else the
// suite has run by the time this test reads it.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Compliance Test Premises`;
});

test("the compliance dashboard reflects a premises' actual record, and updates as it's completed", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting the premises this creates (global-teardown.js's cleanup query)
  // cascades to everything recorded against it.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(NAME);
  // 5 or more employees is one of the three triggers for the duty to record
  // (see backend/README.md) - this premises needs to actually be under that
  // duty for the checklist below to say so.
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- select it on the dashboard and read its starting position ---------

  await page.goto("/");
  await page.getByLabel("Premises").selectOption({ label: NAME });
  await expect(page.getByRole("heading", { name: NAME, level: 2 })).toBeVisible();

  await expectCheck(
    page,
    "No current fire risk assessment is recorded, and this premises is under a duty to record one.",
    "Missing",
  );
  await expectCheck(page, "The duty to record applies: five or more employees.", "OK");
  await expectCheck(page, "No current emergency procedure is recorded.", "Missing");
  await expectCheck(page, "No fire drill is recorded for this premises.", "Missing");
  await expectCheck(page, "No training is recorded for this premises.", "Missing");
  // Not asserting on health_safety_policy here: an organisation-wide policy
  // (premises_id NULL) counts for every premises (see documentVersions() in
  // backend/src/domain/compliance.js), and whether one exists in this shared
  // database is outside this test's control.

  // --- recording something the checklist is missing changes its position -

  await page.goto("/records/emergency_procedures/new");
  await page.locator("#premises_id").selectOption({ label: NAME });
  await page.getByLabel("Title").fill("Serious and imminent danger procedure");
  await page.getByLabel("Procedure").fill("On discovering a fire, operate the nearest call point and evacuate by the nearest available route to the assembly point.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/emergency_procedures");

  // A hard reload rather than clicking back to the dashboard: creating the
  // procedure only invalidates its own list query, not ["compliance", id] -
  // this premises' compliance position is cached client-side for 15s (see
  // lib/queryClient.ts's staleTime) and a reload is the reliable way to see
  // past that rather than racing it. The premises selection itself survives
  // the reload - it's kept in localStorage, not component state.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: NAME, level: 2 })).toBeVisible();
  await expectCheck(page, "1 current emergency procedure(s) recorded.", "OK");
});

async function expectCheck(page, summary, statusText) {
  const row = page.locator("li").filter({ hasText: summary });
  await expect(row).toBeVisible();
  await expect(row.getByText(statusText, { exact: true })).toBeVisible();
}
