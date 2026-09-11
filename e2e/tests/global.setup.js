// Runs once, before every other test file (see the "setup" project and its
// "chromium" dependant in playwright.config.js).
//
// It provisions test accounts the same way backend/tests/helpers.mjs does -
// inserted directly into the database, namespaced with a per-run marker so
// cleanup (global-teardown.js) can find exactly what this run added - then
// signs in through the real login form once per role and saves the resulting
// session (an httpOnly refresh cookie) to disk, so the other spec files can
// start already authenticated instead of repeating the login flow.

import { test as setup } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../backend");
const authDir = path.resolve(here, "../.auth");

dotenv.config({ path: path.join(backendRoot, ".env") });
// Matches the env the backend dev server is started with in
// playwright.config.js, so a hash created here verifies quickly there too.
process.env.NODE_ENV = "test";
process.env.SCRYPT_COST = process.env.SCRYPT_COST ?? "1024";

async function importBackendModule(relativePath) {
  return import(pathToFileURL(path.join(backendRoot, relativePath)).href);
}

// Long enough to satisfy the password policy; never used outside this
// database's test accounts.
const PASSWORD = "correct-horse-battery-staple-42";

setup("provision test accounts and sign in", async ({ page, browser }) => {
  const { pool } = await importBackendModule("src/db/pool.js");
  const { hashPassword } = await importBackendModule("src/auth/passwords.js");

  const marker = `e2e-${Date.now()}`;
  const passwordHash = await hashPassword(PASSWORD);

  const {
    rows: [premises],
  } = await pool.query(
    `INSERT INTO premises (name, town, employee_count, requires_licence)
     VALUES ($1, $2, $3, $4) RETURNING id, name`,
    [`[${marker}] Playwright Test Premises`, "Glasgow", 8, false],
  );

  const {
    rows: [admin],
  } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id, email`,
    [`${marker}-admin@example.test`, `${marker} admin`, passwordHash],
  );

  const {
    rows: [viewer],
  } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, 'viewer') RETURNING id, email`,
    [`${marker}-viewer@example.test`, `${marker} viewer`, passwordHash],
  );
  await pool.query(`INSERT INTO user_premises (user_id, premises_id) VALUES ($1, $2)`, [
    viewer.id,
    premises.id,
  ]);

  await pool.end();

  await mkdir(authDir, { recursive: true });
  await writeFile(
    path.join(authDir, "fixtures.json"),
    JSON.stringify(
      {
        marker,
        password: PASSWORD,
        premisesId: premises.id,
        premisesName: premises.name,
        admin: { email: admin.email },
        viewer: { email: viewer.email },
      },
      null,
      2,
    ),
  );

  await signInAndSaveState(page, admin.email, PASSWORD, path.join(authDir, "admin.json"));

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signInAndSaveState(viewerPage, viewer.email, PASSWORD, path.join(authDir, "viewer.json"));
  await viewerContext.close();
});

async function signInAndSaveState(page, email, password, statePath) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  await page.context().storageState({ path: statePath });
}
