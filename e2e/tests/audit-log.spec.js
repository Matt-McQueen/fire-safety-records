// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// user-admin.spec.js already checks that the audit trail records ordinary
// account-management successes. This is about the other two outcomes the
// log exists to catch - "denied" and "failure" - and that the Outcome filter
// actually finds them:
//
//   - "failure": a wrong password against a real account.
//   - "denied": every 401/403 is audited generically, wherever it's thrown
//     from (backend/src/http/errorHandler.js) - not just the endpoint's own
//     role gate. A manager can reach POST /api/check-schedules (that only
//     needs "manager"), but a domain rule inside it still refuses to mark a
//     schedule statutory for anyone but an admin
//     (backend/src/domain/resources/equipment.js's assertScheduleHonest) -
//     reachable by checking one box on an otherwise ordinary create form, no
//     API bypass needed to produce a genuine one.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let managerEmail;
const PASSWORD = "correct-horse-battery-staple-42";
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  managerEmail = `${fixtures.marker}-manager-for-audit@example.test`;
});

test("the audit log finds a failed login and a role refusal by their outcome", async ({ page, browser }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  // --- produce a "failure": a wrong password against a real account -------

  const wrongPasswordContext = await browser.newContext();
  const wrongPasswordPage = await wrongPasswordContext.newPage();
  await wrongPasswordPage.goto("/login");
  await wrongPasswordPage.getByLabel("Email").fill(fixtures.viewer.email);
  await wrongPasswordPage.getByLabel("Password").fill("definitely-the-wrong-password");
  await wrongPasswordPage.getByRole("button", { name: "Sign in" }).click();
  await expect(wrongPasswordPage.getByText("Email or password is not recognised")).toBeVisible();
  await wrongPasswordContext.close();

  // --- produce a "denied": a manager tries to mark a schedule statutory ---

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(managerEmail);
  await page.getByLabel("Full name").fill("Playwright Audit Manager");
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.locator("#role").selectOption("manager");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await signIn(managerPage, { email: managerEmail, password: PASSWORD });

  await managerPage.goto("/records/check_schedules/new");
  await managerPage.getByLabel("Applies to").fill("equipment_type:extinguisher");
  await managerPage.getByLabel("Check type").fill("Annual service");
  await managerPage.getByLabel("Interval (days)").fill("365");
  await managerPage.getByLabel("Recommended by").fill("BS 5306-3");
  await managerPage.getByRole("checkbox").check(); // the sole boolean field, "Statutory"
  await managerPage.getByRole("button", { name: "Create" }).click();
  await expect(managerPage.getByText(/Only an admin may mark a schedule as statutory/)).toBeVisible();
  await managerContext.close();

  // --- the audit log finds both by outcome ---------------------------------

  await page.goto("/admin/audit-log");
  // Scoped to <main>: the topbar's own "Premises" combobox is on every
  // authenticated page, outside it.
  const outcomeFilter = page.locator("main").getByRole("combobox");

  await outcomeFilter.selectOption("failure");
  const failureRow = page.locator("tbody tr").filter({ hasText: fixtures.viewer.email }).filter({ hasText: "auth.login" });
  await expect(failureRow).toHaveCount(1);
  await expect(failureRow.getByText("failure", { exact: true })).toBeVisible();

  await outcomeFilter.selectOption("denied");
  const deniedRow = page.locator("tbody tr").filter({ hasText: managerEmail }).filter({ hasText: "check-schedules" });
  await expect(deniedRow).toHaveCount(1);
  await expect(deniedRow.getByText("denied", { exact: true })).toBeVisible();
});
