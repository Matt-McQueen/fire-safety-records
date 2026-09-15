// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Walks equipment through its check history: recording a check is refused
// without saying who did it and, for anything but a pass, what was found
// (SSI 2006/456 reg 12 - see assertCheckCoherent in
// backend/src/domain/resources/equipment.js) - and once there is a check
// history, the equipment itself can no longer be deleted outright, only
// taken out of service. The "defect outstanding" status is derived from the
// most recent check, not the equipment's whole history, so a later passing
// check clears it.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
// Tagged with the run's marker for readability; cleanup doesn't need its own
// query for this one - deleting the premises (global-teardown.js) cascades
// to the equipment and its checks.
let LOCATION;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  LOCATION = `[${fixtures.marker}] Corridor extinguisher point`;
});

test("a check history gates deletion, and the latest check decides the defect status", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  const today = new Date().toISOString().slice(0, 10);

  // --- create ----------------------------------------------------------------

  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: fixtures.premisesName });
  await page.locator("#equipment_type").selectOption("extinguisher");
  await page.getByLabel("Location").fill(LOCATION);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(/\/equipment\/\d+$/);
  await expect(page.getByRole("heading", { name: LOCATION })).toBeVisible();

  // --- a failed check is refused without who did it, or what was found -------

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Check type").fill("Annual service");
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Outcome").selectOption("fail");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/must record who carried it out/)).toBeVisible();

  await page.getByLabel("Performed by (contractor)").fill("Playwright Test Fire Services");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/must record what was found in defects_found/)).toBeVisible();

  await page.getByLabel("Defects found").fill("Pressure gauge reading in the red zone; needs recharging.");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // See fra-lifecycle.spec.js: "Defects found" is a textarea, so getByText
  // would match the words this test just typed into it whether or not the
  // check was ever saved. The form closing (onSuccess, and nowhere else) is
  // what actually says so.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByText("Pressure gauge reading in the red zone")).toBeVisible();
  await expect(page.getByText("Fail", { exact: true })).toBeVisible();
  await expect(page.getByText("Defect outstanding")).toBeVisible();

  // --- a later passing check clears the defect status -------------------------

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Check type").fill("Re-inspection");
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Performed by (contractor)").fill("Playwright Test Fire Services");
  await page.getByLabel("Outcome").selectOption("pass");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("Pass", { exact: true })).toBeVisible();
  await expect(page.getByText("Defect outstanding")).toHaveCount(0);

  // --- a check history means the equipment can't just be deleted --------------

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/recorded check\(s\)/)).toBeVisible();
  await expect(page).toHaveURL(/\/equipment\/\d+$/); // refused, not removed

  // --- taking it out of service instead works ---------------------------------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").uncheck(); // the sole boolean field, "In service"
  await page.getByLabel("Removed on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Removed from service")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Record a check" })).toHaveCount(0);
});
