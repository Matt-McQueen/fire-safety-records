// Theme is independent of who's signed in - ThemeProvider wraps the whole
// app in main.tsx, outside AuthProvider - so the first test here never signs
// in at all, and the second uses a fresh viewer login rather than the shared
// session (see global.setup.js for why admin has no saved session to
// restore; the same reasoning applies to reusing any shared one here).
//
// Covers lib/ThemeContext.tsx and the pre-React inline script in index.html
// that's kept in sync with it: which one actually applies before React has
// mounted is what stops the page flashing the wrong theme on load, so this
// checks the effect (the <html> class already being right) rather than the
// mechanism.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

test("defaults to the system's colour scheme when nothing is stored yet", async ({ browser }) => {
  const darkContext = await browser.newContext({ colorScheme: "dark" });
  const darkPage = await darkContext.newPage();
  await darkPage.goto("/login");
  await expect(darkPage.locator("html")).toHaveClass(/dark/);
  await darkContext.close();

  const lightContext = await browser.newContext({ colorScheme: "light" });
  const lightPage = await lightContext.newPage();
  await lightPage.goto("/login");
  await expect(lightPage.locator("html")).not.toHaveClass(/dark/);
  await lightContext.close();
});

test("toggling the theme persists across a reload, overriding system preference", async ({ browser }) => {
  // The system says dark throughout this test, including after the reload -
  // proving it's the stored choice overriding it, not a one-off default.
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await signIn(page, { email: fixtures.viewer.email, password: fixtures.password });

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  // Still signed in - the reload was to check the theme survives it, not to
  // sign out.
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();

  // Toggling back also persists.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await context.close();
});
