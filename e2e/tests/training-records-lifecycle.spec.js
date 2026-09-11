// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// Covers assertTrainingCoherent in backend/src/domain/resources/procedures.js:
// reg 20(4) requires training to happen during working hours, and a record
// saying it didn't has to explain why rather than leave that as a bare flag;
// a next_due_on before the delivery date is incoherent regardless. Also
// covers training's place in the compliance checklist as a live check -
// "missing" with none recorded, "ok" once one is, "attention" once one is
// actually overdue - and that an overdue record's own "Overdue" badge on the
// list agrees with it.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let PERSON_NAME;
let PROVIDER;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] Training Lifecycle Premises`;
  PERSON_NAME = `[${fixtures.marker}] Training Lifecycle Person`;
  PROVIDER = `${fixtures.marker} Fire Training Co`;
});

test("training outside working hours needs to say why, and an overdue refresher shows up as such", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the training records; the person is cleaned up separately by the same
  // marker-tagged pattern (see global-teardown.js).
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);
  const premisesUrl = page.url();
  const premisesId = premisesUrl.match(/\/premises\/(\d+)$/)[1];

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(PERSON_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  await page.goto(premisesUrl);
  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(page, "No training is recorded for this premises.", "Missing");

  // --- training outside working hours needs to say why --------------------

  await page.goto("/records/training_records/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: PERSON_NAME });
  await page.locator("#training_type").selectOption("fire_warden");
  await page.getByLabel("Delivered on").fill(today);
  // Forces an explicit `false` rather than leaving the field untouched
  // (undefined) - the rule only fires on an actual false, since recording
  // nothing about working hours isn't the same claim as recording that it
  // didn't happen during them.
  await page.getByRole("checkbox").check();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/If it did not, content_summary must explain/)).toBeVisible();

  await page.getByLabel("Content summary").fill(
    "Delivered during a Saturday refresher session at the person's request, outside normal working hours.",
  );
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/training_records");

  await page.goto(premisesUrl);
  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(page, "1 person(s) trained", "OK");

  // --- a next_due_on before the delivery date is incoherent ----------------

  const fortyDaysAgo = daysAgo(40);
  const tenDaysAgo = daysAgo(10);

  await page.goto("/records/training_records/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#person_id").selectOption({ label: PERSON_NAME });
  await page.locator("#training_type").selectOption("refresher");
  await page.getByLabel("Delivered on").fill(fortyDaysAgo);
  await page.getByLabel("Provider").fill(PROVIDER);
  await page.getByLabel("Next due on").fill(daysAgo(41)); // before delivered_on
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/next_due_on cannot be before delivered_on/)).toBeVisible();

  // --- an overdue one shows up as such, on both the list and compliance ---

  await page.getByLabel("Next due on").fill(tenDaysAgo); // in the past, but after delivered_on
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/training_records");

  // The list doesn't show a "Provider" column, so the refresher record (the
  // only one of this premises' two expected to be overdue) is found by
  // training type instead.
  await page.goto(`/records/training_records?premises_id=${premisesId}`);
  const overdueRow = page.locator("tbody tr").filter({ hasText: "Refresher" });
  await expect(overdueRow.getByText("Overdue", { exact: true })).toBeVisible();

  await page.goto(premisesUrl);
  await page.getByRole("button", { name: "Compliance" }).click();
  await expectCheck(page, "training record(s) are past their refresher date", "Needs attention");
});

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function expectCheck(page, summary, statusText) {
  const row = page.locator("li").filter({ hasText: summary });
  await expect(row).toBeVisible();
  await expect(row.getByText(statusText, { exact: true })).toBeVisible();
}
