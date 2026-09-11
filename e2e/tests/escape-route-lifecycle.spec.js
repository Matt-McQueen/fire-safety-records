// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// escape-route-checks.spec.js already covers the check-history side of an
// escape route in depth (coherency rules, "obstruction outstanding", delete
// refused with history). This is the record's own lifecycle instead: its
// full field set actually saves and reads back, going out of service and
// back into it both work with no restriction either way (there's no
// beforeUpdate rule on escape_routes, only beforeDelete), and - since this
// one's never given a check - it can actually be deleted, which the other
// test's route never reaches.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Workshop to North Exit`;
});

test("an escape route's full record, and going out of and back into service, round-trip correctly", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting the premises this creates (global-teardown.js's cleanup query)
  // cascades to the escape route.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(`[${fixtures.marker}] Escape Route Lifecycle Premises`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesName = `[${fixtures.marker}] Escape Route Lifecycle Premises`;

  // --- create with its full field set --------------------------------------

  await page.goto("/escape-routes/new");
  await page.locator("#premises_id").selectOption({ label: premisesName });
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByLabel("Description").fill("Main corridor from the workshop to the north fire exit.");
  await page.getByLabel("Final exit").fill("North fire exit onto Quay Street");
  await page.getByLabel("Capacity (persons)").fill("45");
  await page.getByLabel("Travel distance (m)").fill("22.5");
  await page.getByRole("checkbox").nth(0).check(); // has_emergency_lighting
  await page.getByLabel("Signage notes").fill("Photoluminescent signage fitted throughout.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/escape-routes\/\d+$/);

  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
  await expect(page.getByText("Emergency lighting")).toBeVisible();
  await expect(page.getByText("Main corridor from the workshop")).toBeVisible();
  await expect(page.getByText("North fire exit onto Quay Street")).toBeVisible();
  await expect(page.getByText("45", { exact: true })).toBeVisible();
  // NUMERIC(6,2) in the database - comes back as "22.50", not "22.5".
  await expect(page.getByText("22.50", { exact: true })).toBeVisible();
  await expect(page.getByText("Photoluminescent signage fitted throughout.")).toBeVisible();

  // --- editing it persists a change, including turning a badge off --------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Capacity (persons)").fill("50");
  await page.getByRole("checkbox").nth(0).uncheck(); // has_emergency_lighting
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("50", { exact: true })).toBeVisible();
  await expect(page.getByText("Emergency lighting")).toHaveCount(0);

  // --- going out of service and back into it both just work ---------------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").nth(1).uncheck(); // in_service
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Out of service")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Record a check" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").nth(1).check(); // in_service
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Out of service")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Record a check" })).toBeVisible();

  // --- with no check history recorded against it, it can be deleted -------

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/escape-routes");
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
});
