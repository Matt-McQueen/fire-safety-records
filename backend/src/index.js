// Server entry point.
//
// Starts the API, and shuts it down cleanly: stop accepting connections, let
// the requests in flight finish, then close the database pool. A hard exit
// mid-transaction would leave a half-written record.

import { config } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/db.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Fire safety records API listening on http://localhost:${config.port}`);
  console.log(`Environment: ${config.env}`);
  if (!config.auth.secureCookies) {
    console.log(
      "Refresh cookies are not marked Secure. That is expected over plain HTTP locally; set SECURE_COOKIES=true behind TLS.",
    );
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down.`);

  server.close(async (error) => {
    if (error) console.error("Error closing server", error);
    try {
      await pool.end();
    } catch (poolError) {
      console.error("Error closing the database pool", poolError);
    }
    process.exit(error ? 1 : 0);
  });

  // A request that never finishes must not hold the process open forever.
  setTimeout(() => {
    console.error("Shutdown timed out; exiting.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// An unhandled rejection means a promise failed with nobody watching. The
// process state is unknown from there, so it is logged loudly and the process
// is brought down rather than left running in an unknown state.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
  shutdown("unhandledRejection");
});
