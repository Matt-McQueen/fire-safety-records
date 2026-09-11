// Runs unauthenticated (no storageState), so every test starts as a fresh
// visitor - a real login through the actual form, against the real API.

import { test, expect } from "@playwright/test";
import { loadFixtures } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Fire Safety Records" })).toBeVisible();
});

test("a wrong password is rejected without saying which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixtures.viewer.email);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Email or password is not recognised")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("signing in reaches the dashboard, and signing out returns to login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixtures.viewer.email);
  await page.getByLabel("Password").fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();

  // Sign out lives behind the user menu in the top right, not a plain
  // "Logout" link - see components/layout/Topbar.tsx. It's the last button in
  // the header: hamburger, theme toggle, then the user menu trigger.
  await page.locator("header").getByRole("button").last().click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login$/);
});
