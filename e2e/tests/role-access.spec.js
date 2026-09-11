// Runs signed in as the viewer account tests/global.setup.js created - the
// lowest role, scoped to one premises (see backend/README.md's Roles and
// premises section). Checks that the frontend actually hides and blocks what
// the role can't do, rather than just relying on the API to refuse it.
//
// Tests 1-3 share one browser context and, after the first hard navigation,
// move around by clicking - the way a real user browses - rather than by
// calling page.goto() again. That matters here specifically because the
// refresh cookie is single-use: the backend rotates it on every refresh and
// treats a second presentation of an already-rotated one as theft, revoking
// the session (see backend/src/auth/authService.js's refresh()). A second
// hard reload against the same session is occasionally rotated again in the
// background (a query elsewhere retrying a request after its own 401), which
// a `.auth/viewer.json`-loaded *second* context has no way to see - so rather
// than fight that, the last test (the one that genuinely needs a hard
// navigation, to check a typed-in URL rather than an in-app link) gets its
// own fresh login instead of reusing this file's session.

import { test, expect } from "@playwright/test";
import { authStatePath, loadFixtures } from "./helpers/fixtures.js";

test.describe.configure({ mode: "serial" });

let context;
let page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ storageState: authStatePath("viewer") });
  page = await context.newPage();
  await page.goto("/");
});

test.afterAll(async () => {
  await context.close();
});

test("a viewer reaches the dashboard for their premises", async () => {
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
});

test("admin-only navigation is not shown to a viewer", async () => {
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
});

test("a viewer cannot create a premises", async () => {
  await page.getByRole("link", { name: "Premises", exact: true }).click();
  await expect(page).toHaveURL("/premises");
  await expect(page.getByRole("button", { name: "+ New premises" })).toHaveCount(0);
});

test("an admin-only route 404s for a viewer typing the URL directly", async ({ browser }) => {
  const fixtures = await loadFixtures();
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();

  await freshPage.goto("/login");
  await freshPage.getByLabel("Email").fill(fixtures.viewer.email);
  await freshPage.getByLabel("Password").fill(fixtures.password);
  await freshPage.getByRole("button", { name: "Sign in" }).click();
  await freshPage.waitForURL("/");

  await freshPage.goto("/admin/users");
  await expect(freshPage.getByText("Page not found")).toBeVisible();

  await freshContext.close();
});
