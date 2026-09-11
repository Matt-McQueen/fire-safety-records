// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// A drill that found no issues is a clean record; one that found issues but
// doesn't say what was done about them is refused - a drill is how reg
// 14(1)'s requirement that the procedures actually work is tested, and a
// record of a problem with nothing done about it isn't evidence that it was
// (backend/src/domain/resources/procedures.js's assertDrillCoherent). Also
// covers fire_drills' place in the compliance checklist: "missing" with none
// recorded, "ok" once one is - a live check, not a static message.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Fire Drills Lifecycle Premises`;
});

test("a drill with issues needs to say what was done about them, and recording one satisfies the compliance check", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the drills.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesUrl = page.url();
  const premisesId = premisesUrl.match(/\/premises\/(\d+)$/)[1];

  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(page, "No fire drill is recorded for this premises.", "Missing");

  const heldAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

  // --- a drill with no issues is a clean record ----------------------------

  await page.goto("/records/fire_drills/new");
  await page.locator("#premises_id").selectOption({ label: NAME });
  await page.getByLabel("Held at").fill(heldAt);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/fire_drills");

  await page.goto(`/records/fire_drills?premises_id=${premisesId}`);
  await expect(page.locator("tbody tr").filter({ hasText: "No issues" })).toHaveCount(1);

  // --- one with issues but no actions taken is refused ---------------------

  await page.goto("/records/fire_drills/new");
  await page.locator("#premises_id").selectOption({ label: NAME });
  await page.getByLabel("Held at").fill(heldAt);
  await page.getByLabel("Issues identified").fill("The east stairwell fire door failed to self-close.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/actions_taken must record what was done/)).toBeVisible();

  await page.getByLabel("Actions taken").fill("Door closer adjusted on site; re-tested and confirmed closing correctly.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/fire_drills");

  await page.goto(`/records/fire_drills?premises_id=${premisesId}`);
  await expect(page.locator("tbody tr").filter({ hasText: "No issues" })).toHaveCount(1);
  await expect(page.locator("tbody tr").filter({ hasText: "Issues found" })).toHaveCount(1);

  // --- recording one satisfies the "fire drills" compliance check ---------

  await page.goto(premisesUrl);
  await page.getByRole("button", { name: "Compliance" }).click();
  // Not asserting the exact summary: it names either the next due date or
  // that no drill interval is configured, depending on whether an
  // organisation-wide check schedule for 'fire_drill' exists in this shared
  // database (see drills() in backend/src/domain/compliance.js) - outside
  // this test's control either way, but a drill just recorded can never be
  // overdue, so the status itself is deterministic regardless.
  await expectCheck(page, "Last drill", "OK");
});

async function expectCheck(page, summary, statusText) {
  const row = page.locator("li").filter({ hasText: summary });
  await expect(row).toBeVisible();
  await expect(row.getByText(statusText, { exact: true })).toBeVisible();
}
