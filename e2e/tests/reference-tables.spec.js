// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore) - though
// legal_basis and schedule2_measures are readable by any signed-in role (see
// their permissions in resources/configs.ts), admin is used here simply
// because every other lifecycle spec already logs in fresh as admin rather
// than risk racing viewer.json's single-use session (see global.setup.js).
//
// legal_basis and schedule2_measures describe the legislation itself, not
// anything a premises owns, so pages/resource/ReferenceListPage.tsx renders
// them as a plain, unfiltered, unlinked read-only table: no "+ New" button,
// and no row is a link anywhere (config.fields is empty for both - see
// resources/configs.ts), only the search box. The rows themselves are fixed
// reference data seeded once in backend/src/db/schema.sql, not created by any
// test, so this only ever reads them.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

test("the legal basis catalogue is a searchable, read-only table", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  await page.goto("/reference/legal_basis");
  await expect(page.getByRole("heading", { name: "Legal basis catalogue" })).toBeVisible();
  await expect(page.getByRole("button", { name: /\+ New/ })).toHaveCount(0);
  await expect(page.getByText("Duty to record as soon as practicable after an assessment")).toBeVisible();

  const search = page.getByPlaceholder("Search…");
  await search.fill("reg 20");
  await expect(
    page.getByText("Fire safety training on first employment, on new or changed risks"),
  ).toBeVisible();
  await expect(page.getByText("Written statement of general policy on health and safety")).toHaveCount(0);

  // No row is a link - this table has nothing for a click to open.
  await expect(page.locator("tbody a")).toHaveCount(0);
});

test("the Schedule 2 measures catalogue is a searchable, read-only table", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  await page.goto("/reference/schedule2_measures");
  await expect(page.getByRole("heading", { name: "Schedule 2 measures" })).toBeVisible();
  await expect(page.getByRole("button", { name: /\+ New/ })).toHaveCount(0);
  await expect(page.getByText("measures in relation to the means of escape from relevant premises")).toBeVisible();

  const search = page.getByPlaceholder("Search…");
  await search.fill("escape");
  await expect(page.getByText("measures in relation to the means of escape from relevant premises")).toBeVisible();
  await expect(page.getByText("measures in relation to detecting fires and giving warning")).toHaveCount(0);

  await expect(page.locator("tbody a")).toHaveCount(0);
});
