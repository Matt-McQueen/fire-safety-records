// Signs in fresh as the viewer account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore; the same
// reasoning applies to reusing any shared session here) at a phone-sized
// viewport, where AppShell.tsx swaps the always-visible sidebar for a
// hamburger-triggered slide-out panel below Tailwind's lg breakpoint
// (1024px). Below that breakpoint the desktop <aside> stays in the DOM -
// just hidden via CSS - and opening the panel adds a second, visible one, so
// locators below are scoped to tell the two apart rather than assuming
// there's only one.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

test("the sidebar becomes a slide-out panel below the lg breakpoint", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, { email: fixtures.viewer.email, password: fixtures.password });

  // The desktop sidebar is in the DOM but not shown at this width, and the
  // hamburger that opens the slide-out one is.
  await expect(page.locator("aside").first()).not.toBeVisible();
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu).toBeVisible();

  // Opening it adds a second <aside> with the same navigation.
  await openMenu.click();
  await expect(page.locator("aside")).toHaveCount(2);
  const panel = page.locator("aside").last();
  await expect(panel.getByRole("link", { name: "Premises", exact: true })).toBeVisible();

  // Clicking a link in it both navigates and closes the panel.
  await panel.getByRole("link", { name: "Premises", exact: true }).click();
  await expect(page).toHaveURL("/premises");
  await expect(page.locator("aside")).toHaveCount(1);

  // Opening it again and clicking the backdrop closes it without navigating.
  // The backdrop button covers the whole screen but the panel sits visually
  // on top of its left 256px (w-64) - clicked well to the right of that so
  // the click actually lands on the backdrop, not the panel over it.
  await openMenu.click();
  await expect(page.locator("aside")).toHaveCount(2);
  await page.getByRole("button", { name: "Close menu" }).click({ position: { x: 350, y: 400 } });
  await expect(page.locator("aside")).toHaveCount(1);
  await expect(page).toHaveURL("/premises");

  // Above the breakpoint: a static sidebar, and no hamburger to open one.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("aside").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Open menu" })).not.toBeVisible();

  await context.close();
});
