// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore), which each
// test uses to provision its own dedicated premises and role account -
// self-contained rather than sharing state with the other test in this file,
// so either can run alone or in parallel with it.
//
// role-access.spec.js already covers viewer (read-only) against admin-only
// pages. This is the two roles in between: assessor may create and amend
// records but not delete or publish them; manager may also do those - except
// deleting a premises outright, which (unlike equipment or a draft
// assessment) needs admin specifically. See the permissions on each
// resource in resources/configs.ts and resources/fra.ts, and PremisesFormPage
// and PremisesDetailPage's own canRemove/canEdit checks for premises.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
});

const PASSWORD = "correct-horse-battery-staple-42";

// Creates a premises and a single role account granted access to it, signed
// in as admin on the given page. Returns the premises name and the new
// account's credentials.
//
// The premises name keeps global-teardown.js's cleanup pattern
// ("premises WHERE name LIKE '[<marker>]%'") intact by putting the marker in
// its own, unmodified brackets - "assessor"/"manager" belongs in the visible
// name after it, not folded into the bracketed tag itself, or this stops
// matching and the row is never cleaned up.
async function provision(page, { role, town }) {
  const premisesName = `[${fixtures.marker}] ${role} Role Test Premises`;
  const email = `${fixtures.marker}-${role}-role@example.test`;

  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(premisesName);
  await page.getByLabel("Town").fill(town);
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill(`Playwright ${role} Role User`);
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.locator("#role").selectOption(role);
  await page.getByLabel(premisesName).check();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  return { premisesName, email };
}

test("an assessor may create and amend records, but not delete or publish them", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const { premisesName, email } = await provision(page, { role: "assessor", town: "Dundee" });

  await signIn(page, { email, password: PASSWORD });
  const today = new Date().toISOString().slice(0, 10);

  // Cannot create or edit a premises: the button and the field to reach it
  // are both gone, not just disabled behind a role check nobody can see.
  await page.goto("/premises");
  await expect(page.getByRole("button", { name: "+ New premises" })).toHaveCount(0);
  await page.getByRole("link", { name: premisesName }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

  // Can create a fire risk assessment and record a finding against its own
  // draft, but neither publish it nor delete it.
  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: premisesName });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Emergency lighting in the stairwell not illuminating on test.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // See fra-lifecycle.spec.js: the text alone is matched by the textarea this
  // test just typed into, so the form closing is what actually says the
  // finding was saved. Left unfixed the first time #8 covered this file's
  // second occurrence - this one doesn't race a publish, but it's the same
  // defect: it would pass whether or not the finding ever reached the server.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByText("Emergency lighting in the stairwell")).toBeVisible();

  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);

  // Can create equipment and record a check against it, but not delete it.
  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: premisesName });
  await page.locator("#equipment_type").selectOption("extinguisher");
  await page.getByLabel("Location").fill("Ground floor corridor");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/equipment\/\d+$/);

  await page.getByRole("button", { name: "+ Record a check" }).click();
  await page.getByLabel("Check type").fill("Annual service");
  await page.getByLabel("Performed on").fill(today);
  await page.getByLabel("Performed by (contractor)").fill("Playwright Test Fire Services");
  await page.getByLabel("Outcome").selectOption("pass");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Pass", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("a manager may delete a draft assessment or a piece of equipment, but not a premises", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const { premisesName, email } = await provision(page, { role: "manager", town: "Perth" });

  await signIn(page, { email, password: PASSWORD });
  const today = new Date().toISOString().slice(0, 10);

  // Can edit a premises, but even a manager can't delete one outright -
  // PremisesFormPage's canRemove needs admin specifically.
  await page.goto("/premises");
  await page.getByRole("link", { name: premisesName }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Town").fill("Stirling");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Stirling")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // Can publish a draft assessment (unlike an assessor), and could equally
  // have deleted it instead while it was still a draft.
  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: premisesName });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);

  await expect(page.getByRole("button", { name: "Delete draft" })).toBeVisible();

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Fire exit signage missing above the loading bay door.");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // See fra-lifecycle.spec.js: the text alone is matched by the textarea this
  // test just typed into, so the form closing is what actually says the finding
  // was saved.
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByText("Fire exit signage missing")).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  // Can delete equipment with no check history.
  await page.goto("/equipment/new");
  await page.locator("#premises_id").selectOption({ label: premisesName });
  await page.locator("#equipment_type").selectOption("fire_blanket");
  await page.getByLabel("Location").fill("Kitchenette");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/equipment\/\d+$/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/equipment");
});
