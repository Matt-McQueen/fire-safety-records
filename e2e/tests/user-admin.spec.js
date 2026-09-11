// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Walks account administration end to end: creating a user grants it the
// premises checked on the form, changing its role is reflected in the list,
// deactivating it actually signs it out of the ability to sign in again (not
// just a status badge), and an admin editing their own account is kept from
// locking themselves out (see backend/src/routes/users.js's assertNotLastAdmin
// and the isSelf restrictions in UserFormPage.tsx). Finishes by checking the
// audit trail recorded all three account changes.
//
// Deliberately not tested here: actually hitting "last admin" refusal. That
// depends on how many other admin accounts already exist in this shared
// database, which this test has no control over and shouldn't assume.
//
// The list has no pagination and the API caps it at 100 rows, sorted by
// email - and this shared database holds a couple hundred accounts (mostly
// long-abandoned "apitest-..." ones from an interrupted backend test run,
// worth mentioning to whoever owns this database but not this test's to
// clean up). Every account this test needs to find is looked up through the
// search box rather than assumed to be on the first page.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let EMAIL;
const PASSWORD = "correct-horse-battery-staple-42";
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  // Matches global-teardown.js's existing cleanup pattern
  // ("users WHERE email LIKE '<marker>-%'") without needing a query of its
  // own.
  EMAIL = `${fixtures.marker}-created-by-e2e@example.test`;
});

test("creating, changing the role of, and deactivating a user all take effect", async ({ page, browser }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // --- create, granting one premises --------------------------------------

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Full name").fill("Playwright Created User");
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.getByLabel(fixtures.premisesName).check();
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL("/admin/users");
  const userLink = await findUser(page, EMAIL);
  const userId = (await userLink.getAttribute("href")).match(/\/admin\/users\/(\d+)/)[1];

  // --- editing it shows what was actually saved ---------------------------

  await userLink.click();
  await expect(page).toHaveURL(`/admin/users/${userId}`);
  await expect(page.locator("#role")).toHaveValue("viewer");
  await expect(page.getByLabel(fixtures.premisesName)).toBeChecked();

  // --- changing its role is reflected in the list -------------------------

  await page.locator("#role").selectOption("manager");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/admin/users");
  const row = page.locator("tbody tr").filter({ hasText: EMAIL });
  await page.getByPlaceholder("Search…").fill(fixtures.marker);
  await expect(row.getByText("Manager", { exact: true })).toBeVisible();

  // --- deactivating actually revokes the ability to sign in ----------------

  await row.getByRole("link", { name: EMAIL }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Deactivate" }).click();

  await expect(page).toHaveURL("/admin/users");
  await page.getByPlaceholder("Search…").fill(fixtures.marker);
  await expect(row.getByText("Deactivated", { exact: true })).toBeVisible();

  const deactivatedContext = await browser.newContext();
  const deactivatedPage = await deactivatedContext.newPage();
  await deactivatedPage.goto("/login");
  await deactivatedPage.getByLabel("Email").fill(EMAIL);
  await deactivatedPage.getByLabel("Password").fill(PASSWORD);
  await deactivatedPage.getByRole("button", { name: "Sign in" }).click();
  // The same message a wrong password gets - which of the two it was is in
  // the audit trail, not the response (backend/src/auth/authService.js).
  await expect(deactivatedPage.getByText("Email or password is not recognised")).toBeVisible();
  await deactivatedContext.close();

  // --- an admin can't demote, deactivate or unadmin their own account ------

  await page.goto("/admin/users");
  const selfLink = await findUser(page, fixtures.admin.email);
  await selfLink.click();
  await expect(page.locator("#role")).toBeDisabled();
  await expect(page.locator("#is_active")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  // --- the audit trail recorded all three account changes -------------------

  await page.goto("/admin/audit-log");
  await page.getByPlaceholder("Resource (e.g. incidents)").fill("users");
  const resourceTag = `users #${userId}`;
  for (const action of ["users.create", "users.update", "users.deactivate"]) {
    await expect(
      page.locator("tbody tr").filter({ hasText: resourceTag }).filter({ hasText: action }),
    ).toHaveCount(1);
  }
});

// The unfiltered list is capped at 100 rows and this shared database holds
// far more accounts than that (see the file header), so anything this test
// needs to find goes through the search box first.
async function findUser(page, emailOrTerm) {
  await page.getByPlaceholder("Search…").fill(emailOrTerm);
  const link = page.getByRole("link", { name: emailOrTerm });
  await expect(link).toBeVisible();
  return link;
}
