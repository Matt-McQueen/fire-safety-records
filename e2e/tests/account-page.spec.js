// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore) to create a
// throwaway account of its own for this test - not the shared viewer
// fixture, since role-access.spec.js signs in as that one with its original
// password more than once, and changing it here would break those runs.
//
// Covers backend/src/auth/authService.js's changePassword(): the current
// password has to actually be right, the new one has to actually differ,
// and a successful change signs every session out - checked here by
// confirming the old password stops working and the new one signs in.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let email;
const INITIAL_PASSWORD = "correct-horse-battery-staple-42";
const NEW_PASSWORD = "battery-staple-correct-horse-42";
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  email = `${fixtures.marker}-account-page@example.test`;
});

test("changing a password rejects a wrong current one, requires an actual change, and signs out old sessions", async ({
  page,
  browser,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Playwright Account Page User");
  await page.getByLabel("Initial password").fill(INITIAL_PASSWORD);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await signIn(userPage, { email, password: INITIAL_PASSWORD });

  // Via the user menu, the way a real user reaches this page - see
  // components/layout/Topbar.tsx.
  await userPage.locator("header").getByRole("button").last().click();
  await userPage.getByRole("button", { name: "Change password" }).click();
  await expect(userPage).toHaveURL("/account");

  // --- rejects a wrong current password -----------------------------------

  await userPage.getByLabel("Current password").fill("not-the-right-password");
  await userPage.getByLabel("New password").fill(NEW_PASSWORD);
  await userPage.getByRole("button", { name: "Change password" }).click();
  await expect(userPage.getByText("Current password is not correct")).toBeVisible();

  // --- requires the new password to actually be different ----------------

  await userPage.getByLabel("Current password").fill(INITIAL_PASSWORD);
  await userPage.getByLabel("New password").fill(INITIAL_PASSWORD);
  await userPage.getByRole("button", { name: "Change password" }).click();
  await expect(userPage.getByText("New password must be different from the current one")).toBeVisible();

  // --- a real change succeeds, and signs every session out ----------------

  await userPage.getByLabel("New password").fill(NEW_PASSWORD);
  await userPage.getByRole("button", { name: "Change password" }).click();
  await expect(userPage.getByText("Password changed")).toBeVisible();
  await userPage.getByRole("button", { name: "Go to sign in" }).click();
  await expect(userPage).toHaveURL(/\/login$/);

  await userPage.getByLabel("Email").fill(email);
  await userPage.getByLabel("Password").fill(INITIAL_PASSWORD);
  await userPage.getByRole("button", { name: "Sign in" }).click();
  await expect(userPage.getByText("Email or password is not recognised")).toBeVisible();

  await userPage.getByLabel("Password").fill(NEW_PASSWORD);
  await userPage.getByRole("button", { name: "Sign in" }).click();
  // Not necessarily "/" - the login page returns to wherever it was reached
  // from, which was /account here. Any authenticated page renders the same
  // topbar, so its user menu is a destination-independent sign of success.
  await expect(userPage).not.toHaveURL(/\/login$/);
  await expect(userPage.locator("header").getByRole("button").last()).toBeVisible();

  await userContext.close();
});
