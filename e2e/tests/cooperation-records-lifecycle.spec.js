// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/procedures.js's assertCooperationSubstance:
// reg 18 requires cooperation and coordination between duty holders sharing a
// premises, and the sharing of information on the risks - naming the other
// duty holder without saying what was coordinated (arrangements) or shared
// (information_shared) records the relationship but not the duty itself. The
// rule applies on every edit, not just at creation, so clearing both on an
// existing record is refused the same way.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let OTHER_DUTY_HOLDER;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Cooperation Records Lifecycle Premises`;
  OTHER_DUTY_HOLDER = `[${fixtures.marker}] Neighbouring Tenant Ltd`;
});

test("a cooperation record needs to say what was coordinated or shared, on create and on edit alike", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the record, though this test deletes it directly anyway.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- naming the other duty holder alone is not enough ----------------------

  await page.goto("/records/cooperation_records/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Other duty holder").fill(OTHER_DUTY_HOLDER);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(
      /Record what was coordinated in arrangements, or what was passed on in information_shared \(SSI 2006\/456 reg 18\)/,
    ),
  ).toBeVisible();

  await page.getByLabel("Arrangements").fill("Joint fire alarm testing arranged for the first Monday of each month.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/cooperation_records");

  // --- clearing it again on edit is refused the same way ---------------------

  const row = page.locator("tbody tr").filter({ hasText: OTHER_DUTY_HOLDER });
  await row.getByRole("link", { name: OTHER_DUTY_HOLDER }).click();
  await expect(page).toHaveURL(/\/records\/cooperation_records\/\d+$/);

  await page.getByLabel("Arrangements").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(
      /Record what was coordinated in arrangements, or what was passed on in information_shared \(SSI 2006\/456 reg 18\)/,
    ),
  ).toBeVisible();

  await page.getByLabel("Information shared").fill("Shared the updated fire safety arrangements document.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/cooperation_records");

  // --- and it can be deleted like any other record ----------------------------

  await row.getByRole("link", { name: OTHER_DUTY_HOLDER }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/cooperation_records");
  await expect(page.getByRole("link", { name: OTHER_DUTY_HOLDER })).toHaveCount(0);
});
