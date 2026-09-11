// Runs signed in as the admin account tests/global.setup.js created and
// saved to .auth/admin.json - a manager-or-above role, which is what
// premises create/edit/delete require (see PremisesFormPage.tsx).

import { test, expect } from "@playwright/test";
import { loadFixtures, authStatePath } from "./helpers/fixtures.js";

test.use({ storageState: authStatePath("admin") });

const EDITED_TOWN = "Edinburgh";

// Tagged with the run's marker so global-teardown.js's cleanup query
// ("premises WHERE name LIKE '[marker]%'") also catches it if the test
// itself fails before reaching its own delete step.
let NAME;
test.beforeAll(async () => {
  const fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Playwright CRUD Test`;
});

test("create, edit and delete a premises through the UI", async ({ page }) => {
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await expect(page).toHaveURL("/premises/new");

  // exact: true still isn't enough on its own - the required marker makes the
  // field's accessible name "Name *", not "Name" - so anchor to the start
  // instead, which "Duty holder name" doesn't match.
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByLabel("Town").fill("Aberdeen");
  await page.getByLabel("Employee count").fill("15");
  await page.getByRole("button", { name: "Create" }).click();

  // Created successfully and landed on its detail page.
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  // It shows up in the list.
  await page.goto("/premises");
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();

  // Editing persists a change - the address line on the Overview tab is
  // built from the town, so this exercises both write and read.
  await page.getByRole("link", { name: NAME }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Town").fill(EDITED_TOWN);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/premises\/\d+$/);
  await expect(page.getByText(EDITED_TOWN)).toBeVisible();

  // Deleting removes it again. window.confirm is handled before the click
  // that triggers it, since the dialog blocks until dismissed.
  await page.getByRole("button", { name: "Edit" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/premises");
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
});
