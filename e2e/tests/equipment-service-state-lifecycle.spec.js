// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/equipment.js's assertServiceStateCoherent:
// in_service and removed_on have to agree with each other - equipment marked
// out of service needs to say when, and equipment with a removal date can't
// still claim to be in service - and removed_on can't predate installed_on.
// equipment-checks.spec.js already drives the *successful* path of taking
// equipment out of service (unchecking "In service" and setting "Removed on"
// together); this is the refusals in between that combined flow never hits.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let LOCATION;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Equipment Service State Lifecycle Premises`;
  LOCATION = `[${fixtures.marker}] Plant room extinguisher`;
});

test("in_service and removed_on have to agree, and removed_on can't predate when it was installed", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the equipment - it carries no check history, so nothing here needs
  // equipment-checks.spec.js's own "take out of service instead" workaround.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#equipment_type").selectOption("extinguisher");
  await page.getByLabel("Location").fill(LOCATION);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/equipment\/\d+$/);

  // --- taken out of service needs to say when ---------------------------------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").uncheck(); // the sole boolean field, "In service"
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/removed_on must record when the equipment was taken out of service/)).toBeVisible();

  await page.getByLabel("Removed on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Removed from service")).toBeVisible();

  // --- a removal date means it's not in service, whatever the box says -------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox").check(); // "In service" again, removed_on still set
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(/Equipment with removed_on set is not in service\. Clear removed_on, or set in_service to false/),
  ).toBeVisible();

  await page.getByLabel("Removed on").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Removed from service")).toHaveCount(0);

  // --- removed_on can't predate installed_on ----------------------------------

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Installed on").fill(today);
  await page.getByRole("checkbox").uncheck(); // "In service"
  await page.getByLabel("Removed on").fill(yesterday);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/removed_on cannot be before installed_on/)).toBeVisible();
});
