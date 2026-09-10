// Loads the sample data in src/db/sample-data.sql.
//
//   npm run seed          clear the sample data, then insert it
//   npm run seed:clear    clear the sample data only
//
// Everything runs in a single transaction, so a failure leaves the database
// as it was. Clearing is scoped to the sample premises and people by name;
// real records are not touched.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const { pool } = await import("../src/db/pool.js");

const clearOnly = process.argv.includes("--clear");
const sqlDir = path.join(backendRoot, "src", "db");
const read = (file) => readFile(path.join(sqlDir, file), "utf8");

const client = await pool.connect();
try {
  await client.query("BEGIN");

  await client.query(await read("sample-data-clear.sql"));
  console.log(clearOnly ? "Cleared sample data." : "Cleared any existing sample data.");

  if (!clearOnly) {
    await client.query(await read("sample-data.sql"));
    console.log("Inserted sample data.\n");

    const { rows } = await client.query(`
      SELECT 'premises' AS table_name, count(*) FROM premises
      UNION ALL SELECT 'people', count(*) FROM people
      UNION ALL SELECT 'fire_risk_assessments', count(*) FROM fire_risk_assessments
      UNION ALL SELECT 'fra_significant_findings', count(*) FROM fra_significant_findings
      UNION ALL SELECT 'fra_measures', count(*) FROM fra_measures
      UNION ALL SELECT 'fra_persons_at_risk', count(*) FROM fra_persons_at_risk
      UNION ALL SELECT 'fire_safety_arrangements', count(*) FROM fire_safety_arrangements
      UNION ALL SELECT 'dangerous_substances', count(*) FROM dangerous_substances
      UNION ALL SELECT 'check_schedules', count(*) FROM check_schedules
      UNION ALL SELECT 'equipment', count(*) FROM equipment
      UNION ALL SELECT 'equipment_checks', count(*) FROM equipment_checks
      UNION ALL SELECT 'escape_routes', count(*) FROM escape_routes
      UNION ALL SELECT 'escape_route_checks', count(*) FROM escape_route_checks
      UNION ALL SELECT 'emergency_procedures', count(*) FROM emergency_procedures
      UNION ALL SELECT 'fire_drills', count(*) FROM fire_drills
      UNION ALL SELECT 'training_records', count(*) FROM training_records
      UNION ALL SELECT 'employee_information_records', count(*) FROM employee_information_records
      UNION ALL SELECT 'cooperation_records', count(*) FROM cooperation_records
      UNION ALL SELECT 'health_safety_policies', count(*) FROM health_safety_policies
      UNION ALL SELECT 'incidents', count(*) FROM incidents
      UNION ALL SELECT 'enforcement_notices', count(*) FROM enforcement_notices
      UNION ALL SELECT 'enforcement_visits', count(*) FROM enforcement_visits
      ORDER BY 1`);
    for (const r of rows) console.log(`  ${r.table_name.padEnd(30)} ${String(r.count).padStart(3)}`);
  }

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nFailed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
