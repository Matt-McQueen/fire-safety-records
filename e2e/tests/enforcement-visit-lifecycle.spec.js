// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Enforcement visits are the simplest of this domain's records - no status
// machine, no compliance-checklist tie-in, and exactly one rule
// (backend/src/domain/resources/incidents.js): a visit can't be dated in the
// future. What's actually worth pinning down here is the role boundary:
// creating one needs manager specifically, one rank above what an assessor
// can reach - unlike a fire risk assessment draft or a piece of equipment,
// which an assessor can create outright (see role-capabilities.spec.js).

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let PURPOSE;
const PASSWORD = "correct-horse-battery-staple-42";
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Enforcement Visit Lifecycle Premises`;
  // Tagged rather than left as a plain "Routine inspection": the list this
  // test finds it in isn't scoped to this premises (there's no premises
  // picker selected), so a generic phrase risks matching another visit
  // already in this shared database.
  PURPOSE = `Routine inspection (${fixtures.marker})`;
});

test("a visit can't be dated in the future, and its record round-trips through an edit", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the visit, though this test deletes it directly anyway.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  // --- can't be dated in the future ----------------------------------------

  await page.goto("/records/enforcement_visits/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.getByLabel("Authority").fill("Scottish Fire and Rescue Service");
  await page.getByLabel("Officer name").fill("A. Reid");
  await page.getByLabel("Visited on").fill(tomorrow);
  await page.getByLabel("Purpose").fill(PURPOSE);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/visited_on cannot be in the future/)).toBeVisible();

  // --- its record round-trips through an edit ------------------------------

  await page.getByLabel("Visited on").fill(today);
  await page.getByLabel("Documents provided").fill("Fire risk assessment summary and equipment maintenance log.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/enforcement_visits");

  await page.getByRole("link", { name: PURPOSE }).click();
  await expect(page).toHaveURL(/\/records\/enforcement_visits\/\d+$/);
  await expect(page.getByLabel("Authority")).toHaveValue("Scottish Fire and Rescue Service");

  await page.getByLabel("Findings").fill("No significant issues found; one minor housekeeping observation raised verbally.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/records/enforcement_visits");

  await page.getByRole("link", { name: PURPOSE }).click();
  await expect(page.getByLabel("Findings")).toHaveValue(
    "No significant issues found; one minor housekeeping observation raised verbally.",
  );

  // --- and it can be deleted -----------------------------------------------

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/records/enforcement_visits");
  await expect(page.getByRole("link", { name: PURPOSE })).toHaveCount(0);
});

test("an assessor can't create one at all - it needs manager, not just assessor", async ({ page }) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });

  const email = `${fixtures.marker}-assessor-for-visits@example.test`;
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Playwright Assessor For Visits");
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.locator("#role").selectOption("assessor");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  await signIn(page, { email, password: PASSWORD });
  await page.goto("/records/enforcement_visits");
  await expect(page.getByRole("button", { name: "+ New enforcement visit" })).toHaveCount(0);
});
