import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real frontend and backend against the real
// database, the same way backend/tests/*.test.mjs do — see global-setup.js
// for the fixtures that creates and global-teardown.js for how they are
// removed again. That means these tests need backend/.env configured with a
// working DATABASE_URL before they can run.

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  globalTeardown: "./global-teardown.js",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Starts both dev servers and waits for them to answer before any test (or
  // the setup project) runs, and tears them down afterwards. reuseExistingServer
  // means a server you already have running locally is left alone and used
  // as-is — handy while iterating on a test.
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      url: "http://localhost:3001/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // NODE_ENV=test disables the blanket rate limit (see backend/src/app.js),
      // which otherwise has no reason to apply to a suite running from one
      // machine. RATE_LIMIT_LOGIN is raised the same way backend/tests/helpers.mjs
      // raises it, so re-running the suite a few times in a row doesn't lock
      // the machine's address out of /api/auth/login (default is 10/15min).
      // A low scrypt cost keeps the account creation in global-setup.js fast;
      // it only ever protects test accounts.
      env: { NODE_ENV: "test", SCRYPT_COST: "1024", RATE_LIMIT_LOGIN: "10000" },
    },
    {
      command: "npm run dev",
      cwd: "../frontend",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],

  // The "setup" project provisions test accounts (directly in the database)
  // and signs in through the real UI once per role, saving the resulting
  // session so the other tests can start already authenticated instead of
  // logging in over and over. See tests/global.setup.js.
  projects: [
    { name: "setup", testMatch: /global\.setup\.js/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
