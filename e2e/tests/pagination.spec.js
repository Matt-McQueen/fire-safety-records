// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Nothing anywhere else in this suite ever clicks Next or Previous - every
// other list either stays under one page by construction, or (as safety-
// roles-lifecycle.spec.js found out the hard way) is scoped down with a
// premises_id filter specifically so it does. This instead makes a list
// deliberately span two pages and drives Pagination
// (components/ui/primitives.tsx) itself: LIMIT is 25
// (pages/resource/useResourceListQuery.ts), so 26 same-named people are
// created and then found only by searching for that name, independent of
// whatever the shared dev database and every other spec file's own fixtures
// otherwise hold in the people table.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let NAME_PREFIX;
const COUNT = 26;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  NAME_PREFIX = `[${fixtures.marker}] Pagination Person`;
});

test("Next and Previous move between pages, and their counts and labels track it", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  for (let i = 1; i <= COUNT; i++) {
    await page.goto("/records/people/new");
    await page.getByLabel(/^Full name/).fill(`${NAME_PREFIX} ${String(i).padStart(2, "0")}`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL("/records/people");
  }

  await page.goto("/records/people");
  const search = page.getByPlaceholder("Search…");
  await search.fill(NAME_PREFIX);
  await search.press("Enter");

  // --- page 1: the first 25, in full_name's default ascending order ----------

  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.getByText(`Showing 1–25 of ${COUNT}`)).toBeVisible();
  await expect(page.getByText(`Page 1 of 2`)).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME_PREFIX} 01` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME_PREFIX} 26` })).toHaveCount(0);

  const previousButton = page.getByRole("button", { name: "Previous" });
  const nextButton = page.getByRole("button", { name: "Next" });
  await expect(previousButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();

  // --- page 2: the remaining one --------------------------------------------

  await nextButton.click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText(`Showing 26–${COUNT} of ${COUNT}`)).toBeVisible();
  await expect(page.getByText(`Page 2 of 2`)).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME_PREFIX} 26` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME_PREFIX} 01` })).toHaveCount(0);
  await expect(previousButton).toBeEnabled();
  await expect(nextButton).toBeDisabled();

  // --- and back to page 1 -----------------------------------------------------

  await previousButton.click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.getByText(`Page 1 of 2`)).toBeVisible();
  await expect(previousButton).toBeDisabled();
});
