// Signs in fresh as the admin account tests/global.setup.js created (see
// global.setup.js for why admin has no saved session to restore) - and, for
// the same reason applied to a second and third role here, the viewer and
// manager each get their own browser context rather than sharing one page
// with repeated sign-ins: a refresh cookie is single-use and this file would
// otherwise switch accounts on one page several times over.
//
// backend/src/domain/resources/premises.js's people.scope.accessClause: a
// person isn't owned by one premises - staff move between sites, and an
// external assessor may work across several - so unlike every other resource
// in this app, "people" isn't simply premises_id-scoped. A manager or admin
// sees the whole directory; everyone else sees only the people connected to
// a premises they're assigned to, and only through an actual link - a
// safety role, a training record, or an fra_persons_at_risk entry - rather
// than through the person's own record, which carries no premises_id at all.
// This is the one resource-visibility rule in the whole app that isn't
// "belongs to this premises", so it gets its own test rather than being
// assumed to work like the rest.

import { test, expect } from "@playwright/test";
import { loadFixtures, signIn } from "./helpers/fixtures.js";

let fixtures;
let PREMISES_NAME;
let CONNECTED_PERSON;
let UNCONNECTED_PERSON;
const PASSWORD = "correct-horse-battery-staple-42";
test.beforeAll(async () => {
  fixtures = await loadFixtures();
  PREMISES_NAME = `[${fixtures.marker}] People Visibility Scope Premises`;
  CONNECTED_PERSON = `[${fixtures.marker}] Visibility Connected Person`;
  UNCONNECTED_PERSON = `[${fixtures.marker}] Visibility Unconnected Person`;
});

async function searchPeople(page, query) {
  await page.goto("/records/people");
  const search = page.getByPlaceholder("Search…");
  await search.fill(query);
  await search.press("Enter");
}

test("a viewer sees only people linked to their premises by an actual record, not the whole directory", async ({
  page,
  browser,
}) => {
  await signIn(page, { email: fixtures.admin.email, password: fixtures.password });
  const today = new Date().toISOString().slice(0, 10);

  // Deleting this premises (global-teardown.js's cleanup query) cascades to
  // the training record and the viewer's premises grant; the two people are
  // cleaned up separately by their own marker-tagged query, since a person
  // is not owned by one premises.
  await page.goto("/premises");
  await page.getByRole("button", { name: "+ New premises" }).click();
  await page.getByLabel(/^Name/).fill(PREMISES_NAME);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/premises\/\d+$/);

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(CONNECTED_PERSON);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  await page.goto("/records/people/new");
  await page.getByLabel(/^Full name/).fill(UNCONNECTED_PERSON);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/records/people");

  const viewerEmail = `${fixtures.marker}-people-visibility-viewer@example.test`;
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(viewerEmail);
  await page.getByLabel("Full name").fill("Playwright People Visibility Viewer");
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.locator("#role").selectOption("viewer");
  await page.getByLabel(PREMISES_NAME).check();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  const managerEmail = `${fixtures.marker}-people-visibility-manager@example.test`;
  await page.getByRole("button", { name: "+ New user" }).click();
  await page.getByLabel("Email").fill(managerEmail);
  await page.getByLabel("Full name").fill("Playwright People Visibility Manager");
  await page.getByLabel("Initial password").fill(PASSWORD);
  await page.locator("#role").selectOption("manager");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL("/admin/users");

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, { email: viewerEmail, password: PASSWORD });

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await signIn(managerPage, { email: managerEmail, password: PASSWORD });

  try {
    // --- before any link exists, the viewer sees neither person -------------

    await searchPeople(viewerPage, `[${fixtures.marker}] Visibility`);
    await expect(viewerPage.getByRole("link", { name: CONNECTED_PERSON })).toHaveCount(0);
    await expect(viewerPage.getByRole("link", { name: UNCONNECTED_PERSON })).toHaveCount(0);

    // --- a training record links one of them to the viewer's premises -------

    await page.goto("/records/training_records/new");
    await page.locator("#premises_id").selectOption({ label: PREMISES_NAME });
    await page.locator("#person_id").selectOption({ label: CONNECTED_PERSON });
    await page.locator("#training_type").selectOption("induction");
    await page.getByLabel("Delivered on").fill(today);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL("/records/training_records");

    // --- the viewer now sees the linked person, but not the other one -------

    await searchPeople(viewerPage, `[${fixtures.marker}] Visibility`);
    await expect(viewerPage.getByRole("link", { name: CONNECTED_PERSON })).toBeVisible();
    await expect(viewerPage.getByRole("link", { name: UNCONNECTED_PERSON })).toHaveCount(0);

    // --- a manager, by contrast, sees the whole directory regardless --------

    await searchPeople(managerPage, `[${fixtures.marker}] Visibility`);
    await expect(managerPage.getByRole("link", { name: CONNECTED_PERSON })).toBeVisible();
    await expect(managerPage.getByRole("link", { name: UNCONNECTED_PERSON })).toBeVisible();
  } finally {
    await viewerContext.close();
    await managerContext.close();
  }
});
