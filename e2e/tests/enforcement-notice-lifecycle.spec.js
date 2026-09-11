// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// An enforcement notice's in force -> withdrawn lifecycle, and its
// cross-cutting effect while in force: an alterations notice is one of the
// three triggers for the duty to record (see the premises_recording_duty
// view in backend/src/db/schema.sql), independent of employee count or a
// licence. A dedicated premises with neither of those, so the only way its
// duty ever applies here is the notice itself.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME;
let REFERENCE;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Enforcement Notice Lifecycle Premises`;
  REFERENCE = `${fixtures.marker}-ALT-NOTICE`;
});

test("an alterations notice triggers the duty to record while in force, and stops once withdrawn", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the notice.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByLabel("Employee count").fill("2"); // below the 5-employee trigger
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesUrl = page.url();

  await expect(page.getByText("Alterations notice in force")).toHaveCount(0);
  await expect(page.getByText("Duty to record not triggered")).toBeVisible();

  // --- serving one while in force triggers the duty -----------------------

  await page.goto("/records/enforcement_notices/new");
  await page.locator("#premises_id").selectOption({ label: NAME });
  await page.getByLabel("Notice type").selectOption("alterations");
  await page.getByLabel("Reference").fill(REFERENCE);
  await page.getByLabel("Served on").fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("checkbox").check(); // the sole boolean field, "In force"
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/enforcement_notices");

  await page.goto(premisesUrl);
  await expect(page.getByText("Alterations notice in force")).toBeVisible();
  await expect(page.getByText("Duty to record applies")).toBeVisible();

  // --- it can't be deleted while still in force ----------------------------

  await page.goto("/records/enforcement_notices");
  await page.getByRole("link", { name: REFERENCE }).click();
  await expect(page).toHaveURL(/\/records\/enforcement_notices\/\d+$/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/still in force/)).toBeVisible();

  // --- marking it no longer in force needs to say why ----------------------

  await page.getByRole("checkbox").uncheck(); // in_force
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/A notice no longer in force must record why/)).toBeVisible();

  await page.getByLabel("Withdrawn on").fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/enforcement_notices");

  // --- withdrawn, the duty it was the only trigger for stops applying ------

  await page.goto(premisesUrl);
  await expect(page.getByText("Alterations notice in force")).toHaveCount(0);
  await expect(page.getByText("Duty to record not triggered")).toBeVisible();

  // --- no longer in force, it can now be deleted ---------------------------

  await page.goto("/records/enforcement_notices");
  await page.getByRole("link", { name: REFERENCE }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/enforcement_notices");
  await expect(page.getByRole("link", { name: REFERENCE })).toHaveCount(0);
});
