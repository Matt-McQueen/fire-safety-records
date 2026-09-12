// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore).
//
// backend/src/domain/resources/assessments.js's assertMeasureCoherent: a
// measure recorded as "taken" needs completed_on set, one still "planned"
// needs a target_date so it can be seen as outstanding, and a measure with
// completed_on set is not "planned" any more, whichever the client claims.
// The comment above fraMeasures explains the more interesting contrast with
// significant findings: reg 9(1)(a) records the measures taken or to be
// taken, and a planned measure becoming a taken one is that record being
// kept current, not the assessment being rewritten - so, unlike a finding,
// FraDetailPage.tsx still offers "+ Add measure" once the assessment is
// published (canEditMeasures = canWrite && !isSuperseded). Only supersession
// itself closes it, at which point the control disappears from the page
// entirely rather than being refused on submit.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] FRA Measures Lifecycle Premises`;
});

test("a measure needs the date that matches its status, and stays editable once the assessment is published", async ({
  page,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // 8 employees puts this premises under the duty to record (SSI 2006/456
  // regs 8-9), which is what makes at least one finding and a recorded
  // assessor competence preconditions of publishing below.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByLabel("Employee count").fill("8");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate; five years assessing similar premises.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);
  const firstId = Number(page.url().match(/\/fire-risk-assessments\/(\d+)$/)[1]);

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Fire door in the stairwell propped open with a wedge.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The toggle reappearing is the unambiguous signal that the create
  // succeeded and its form closed - waiting on the text alone can otherwise
  // match the still-open field's typed value instead of a real, saved row.
  await expect(page.getByRole("button", { name: "+ Add finding" })).toBeVisible();
  await expect(page.getByText("Fire door in the stairwell")).toBeVisible();

  // --- a planned measure needs a target date ---------------------------------

  await page.getByRole("button", { name: "+ Add measure" }).click();
  await page.getByLabel("Description").fill("Remove the wedge and brief staff on the fire door policy.");
  await page.locator("#status").selectOption("planned");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(/A planned measure must have a target_date, so that it can be seen to be outstanding/),
  ).toBeVisible();

  await page.getByLabel("Target date").fill(today);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add measure" })).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toBeVisible();

  // --- a measure recorded as completed is refused without completed_on -------

  await page.getByRole("button", { name: "+ Add measure" }).click();
  await page.getByLabel("Description").fill("Fire door closer serviced and wedge removed.");
  await page.locator("#status").selectOption("taken");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/A measure recorded as taken must have completed_on set/)).toBeVisible();

  await page.getByLabel("Completed on").fill(today);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add measure" })).toBeVisible();
  await expect(page.getByText("Taken", { exact: true })).toBeVisible();

  // --- completed_on set means it's taken, whatever status claims -------------

  await page.getByRole("button", { name: "+ Add measure" }).click();
  await page.getByLabel("Description").fill("Additional signage ordered for the stairwell.");
  await page.locator("#status").selectOption("planned");
  await page.getByLabel("Target date").fill(today);
  await page.getByLabel("Completed on").fill(today);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(/A measure with completed_on set has been taken\. Change status to 'taken', or clear completed_on/),
  ).toBeVisible();

  await page.getByLabel("Completed on").fill("");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add measure" })).toBeVisible();
  await expect(page.getByText("Additional signage ordered for the stairwell")).toBeVisible();

  // --- publishing locks the finding, but not its measures ---------------------

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "+ Add finding" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add measure" })).toBeVisible();

  await page.getByRole("button", { name: "+ Add measure" }).click();
  await page.getByLabel("Description").fill("Wedge policy reminder reissued to all shift leads.");
  await page.locator("#status").selectOption("taken");
  await page.getByLabel("Completed on").fill(today);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add measure" })).toBeVisible();
  await expect(page.getByText("Wedge policy reminder reissued to all shift leads")).toBeVisible();

  // --- a second, published assessment supersedes this one, closing it fully --

  await page.goto("/fire-risk-assessments/new");
  await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
  await page.locator("#carried_out_on").fill(today);
  await page.getByLabel("External assessor").fill("Playwright Test Assessor");
  await page.getByLabel("Assessor competence").fill("NEBOSH Fire Certificate; five years assessing similar premises.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/fire-risk-assessments\/\d+$/);

  await page.getByRole("button", { name: "+ Add finding" }).click();
  await page.getByLabel("Finding").fill("Annual review found no new significant findings.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Add finding" })).toBeVisible();
  await expect(page.getByText("Annual review found no new significant findings")).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  await page.goto(`/fire-risk-assessments/${firstId}`);
  await expect(page.getByText("Superseded", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add measure" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
});
