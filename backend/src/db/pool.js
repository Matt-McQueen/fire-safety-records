import pg from "pg";

const { Pool } = pg;

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
