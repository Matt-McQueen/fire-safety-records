// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Every resource in resources/configs.ts other than premises, fire risk
// assessments, equipment and escape routes is served by one generic
// list/create/edit engine (components/resource/ResourceTable + ResourceForm,
// pages/resource/*) rather than a bespoke page. This drives that engine
// through "people" - search, a filter, sort's default, create, edit and
// delete - since exercising it once here covers the same code path every
// other generic resource goes through.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
// Tagged with the run's marker so global-teardown.js's cleanup query
// ("people WHERE full_name LIKE '[marker]%'") also catches it if the test
// itself fails before reaching its own delete step.
let NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME = `[${fixtures.marker}] Playwright Test Person`;
});

test("the generic resource engine creates, searches, filters, edits and deletes a record", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // --- create --------------------------------------------------------------

  await page.goto("/records/people");
  await page.getByRole("button", { name: "+ New person" }).click();
  await expect(page).toHaveURL("/records/people/new");

  await page.getByLabel(/^Full name/).fill(NAME);
  await page.getByLabel("Job title").fill("Fire Warden");
  await page.getByRole("checkbox").check(); // the sole boolean field, "Employee"
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL("/records/people");
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();

  // --- search ----------------------------------------------------------------

  const search = page.getByPlaceholder("Search…");
  await search.fill(fixtures.marker);
  await search.press("Enter");
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();

  await search.fill("no-such-person-zzz");
  await search.press("Enter");
  await expect(page.getByText("No records match the current filters.")).toBeVisible();
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);

  await page.goto("/records/people"); // reset search and any filter

  // --- filter ------------------------------------------------------------

  // Neither the "Employee" filter select nor the create form's checkbox has a
  // real accessible name (the label text isn't wired to either control), so
  // this is scoped by position instead: it's the only <select> in the page
  // body itself, ahead of Sort by/Order - the topbar's own "Premises" select
  // lives in the header, outside <main>.
  const employeeFilter = page.locator("main").getByRole("combobox").first();
  await employeeFilter.selectOption("false"); // "No"
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  await employeeFilter.selectOption("true"); // "Yes"
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();

  // --- edit ----------------------------------------------------------------

  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole("link", { name: NAME }).click();
  await expect(page).toHaveURL(/\/records\/people\/\d+$/);

  await page.getByLabel("Job title").fill("Deputy Fire Warden");
  await page.getByLabel("Ended on").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL("/records/people");
  const row = page.locator("tbody tr").filter({ hasText: NAME });
  await expect(row.getByText("Left", { exact: true })).toBeVisible();

  // --- delete --------------------------------------------------------------

  await page.getByRole("link", { name: NAME }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page).toHaveURL("/records/people");
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
});
