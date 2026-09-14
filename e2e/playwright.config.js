import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real frontend and backend against the real
// database, the same way backend/tests/*.test.mjs do — see global-setup.js
// for the fixtures that creates and global-teardown.js for how they are
// removed again. That means these tests need backend/.env configured with a
// working DATABASE_URL before they can run.

// By default the suite drives the two dev servers this config starts itself.
// Setting E2E_BASE_URL points it at an already-deployed frontend instead —
// how the staging deployment is tested — in which case nothing is started
// locally and the deployment's own API is exercised through its Pages proxy.
// DATABASE_URL must then point at that deployment's database, because
// tests/global.setup.js inserts its fixtures directly. Never point this at
// production: it creates and deletes real records. smoke/ is the suite for
// that.
const remoteBaseUrl = (process.env.E2E_BASE_URL ?? "").replace(/\/+$/, "");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  globalTeardown: "./global-teardown.js",

  // Driving a deployment is not driving localhost, and the defaults are tuned
  // for localhost: 30s for a test, 5s for an expect. Against staging every
  // action is a round trip to Frankfurt and on to Neon, through a serverless
  // function that cold-starts between files.
  //
  // Both numbers come from an actual run rather than a guess. pagination.spec
  // creates 26 records one after another and passed 30s doing it; publishing an
  // assessment and seeing the page catch up passed 5s. Four specs failed that
  // way on the first run against staging, every one of them about distance
  // rather than behaviour - the page snapshot showed the record still saying
  // "Draft" with no error anywhere, which is what waiting looks like.
  timeout: remoteBaseUrl ? 120_000 : 30_000,
  expect: { timeout: remoteBaseUrl ? 20_000 : 5_000 },

  use: {
    baseURL: remoteBaseUrl || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Starts both dev servers and waits for them to answer before any test (or
  // the setup project) runs, and tears them down afterwards. reuseExistingServer
  // means a server you already have running locally is left alone and used
  // as-is — handy while iterating on a test.
  // Skipped entirely when testing a deployment: there is nothing to start, and
  // starting a local backend would point the browser at the wrong API.
  webServer: remoteBaseUrl
    ? undefined
    : [
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
          // RATE_LIMIT_REFRESH is raised for the same reason and was, for a long
          // time, this suite's real "database capacity" problem in disguise - see
          // e2e/README.md's history section for how that was actually found.
          // A low scrypt cost keeps the account creation in global-setup.js fast;
          // it only ever protects test accounts. PG_POOL_MAX matches render.yaml's
          // production value: Supabase's session-mode pooler hard-caps at 15
          // clients project-wide (confirmed directly - raising this past it
          // returns a real EMAXCONNSESSION error, not just slower responses), and
          // roughly ten of those are the project's own platform connections.
          env: {
            NODE_ENV: "test",
            SCRYPT_COST: "1024",
            RATE_LIMIT_LOGIN: "10000",
            RATE_LIMIT_REFRESH: "10000",
            PG_POOL_MAX: "5",
          },
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
