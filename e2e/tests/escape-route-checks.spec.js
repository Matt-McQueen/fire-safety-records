// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// The escape route side of the same pattern as equipment-checks.spec.js:
// recording a check is refused, for anything but a pass, without saying what
// was found (SSI 2006/456 reg 13 - see assertRouteCheckCoherent in
// backend/src/domain/resources/equipment.js), a check history then blocks
// deleting the route outright, and "obstruction outstanding" tracks the most
// recent check rather than the whole history. Unlike an equipment check, a
// route check doesn't have to say who performed it - the rule for one simply
// doesn't exist on the other - so this doesn't test for that.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
// Tagged with the run's marker for readability; cleanup doesn't need its own
// query for this one - deleting the premises (global-teardown.js) cascades
// to the escape route and its checks.
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] East stairwell`;
});

test("a check history gates deletion, and the latest check decides the obstruction status", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  const today = new Date().toISOString().slice(0, 10);

  // --- create ------------------------------------------------------------

  await page.goto("/escape-routes/new");
  await page.locator("#premises_id").selectOption({ label: fixtures.premisesName });
  await page.getByLabel(/^Name/).fill(NAME); // required, so its accessible name is "Name *"
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(/\/escape-routes\/\d+$/);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  // --- a failed check is refused without what was found -----------------

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Outcome").selectOption("fail");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/must record what was found in obstructions_found/)).toBeVisible();

  await page.getByLabel("Obstructions found").fill("Stored furniture blocking the fire door at the east stairwell.");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // See fra-lifecycle.spec.js: "Obstructions found" is a textarea, so
  // getByText would match the words this test just typed into it whether or
  // not the check was ever saved. The form closing (onSuccess, and nowhere
  // else) is what actually says so.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByText("Stored furniture blocking the fire door")).toBeVisible();
  await expect(page.getByText("Fail", { exact: true })).toBeVisible();
  await expect(page.getByText("Obstruction outstanding")).toBeVisible();

  // --- a later passing check clears the obstruction status ---------------

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Outcome").selectOption("pass");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("Pass", { exact: true })).toBeVisible();
  await expect(page.getByText("Obstruction outstanding")).toHaveCount(0);

  // --- a check history means the route can't just be deleted -------------

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/recorded check\(s\)/)).toBeVisible();
  await expect(page).toHaveURL(/\/escape-routes\/\d+$/); // refused, not removed

  // --- taking it out of service instead works -----------------------------

  await page.getByRole("button", { name: "Edit" }).click();
  // Two boolean fields on this form (has_emergency_lighting, then in_service
  // - see resources/equipment.ts), neither with a real accessible name (the
  // label text isn't wired to either checkbox), so this is scoped by
  // position: in_service is the second one.
  await page.getByRole("checkbox").nth(1).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Out of service")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Record a check" })).toHaveCount(0);
});
