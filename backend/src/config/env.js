// Environment configuration, validated once at startup.
//
// The process refuses to start on a bad or missing value rather than failing
// later on the first request. Secrets are read here and nowhere else.

import "dotenv/config";
import crypto from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

const problems = [];

function required(name) {
  const value = process.env[name];
  if (!value) problems.push(`${name} is not set`);
  return value;
}

function integer(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    problems.push(`${name} must be an integer of at least ${min}`);
    return fallback;
  }
  return value;
}

function duration(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+[smhd]$/.test(raw)) {
    problems.push(`${name} must look like 15m, 2h or 30d`);
    return fallback;
  }
  return raw;
}

// A weak signing key makes every other control here pointless, so it is
// checked rather than defaulted. Outside production a random key is generated
// so the tests and a fresh checkout run without setup; the cost is that
// restarting invalidates outstanding tokens, which only matters in production.
function signingSecret() {
  const value = process.env.JWT_SECRET;
  if (!value) {
    if (isProduction) {
      problems.push("JWT_SECRET is not set");
      return "";
    }
    return crypto.randomBytes(48).toString("base64url");
  }
  if (value.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters");
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");

// Which deployment this is, and which commit it was built from.
//
// Both are reported by /api/health, which is what makes it possible to tell
// whether a deploy has actually landed before running tests against it. A
// platform that deploys asynchronously (Render, Vercel, Pages all do) will
// happily serve the previous build for a minute or two after a push, and a
// test suite that starts too early tests the old one and passes.
//
// Render and Vercel both inject the commit themselves; GIT_COMMIT is the
// manual override for anywhere that does not. APP_ENVIRONMENT names the
// deployment because NODE_ENV cannot: staging runs with NODE_ENV=production,
// since it is a real deployment and should behave like one.
const commit =
  process.env.GIT_COMMIT ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  null;

export const config = {
  env: process.env.NODE_ENV || "development",
  isProduction,
  isTest,
  environment: process.env.APP_ENVIRONMENT || process.env.NODE_ENV || "development",
  commit,
  port: integer("PORT", 3001),
  databaseUrl,

  // Comma-separated list. The frontend dev server is allowed by default so a
  // fresh checkout works; production must name its origins explicitly.
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  auth: {
    secret: signingSecret(),
    issuer: process.env.JWT_ISSUER || "fire-safety-records",
    audience: process.env.JWT_AUDIENCE || "fire-safety-records-api",
    accessTokenTtl: duration("ACCESS_TOKEN_TTL", "15m"),
    refreshTokenDays: integer("REFRESH_TOKEN_DAYS", 30),
    // scrypt cost (the N parameter). 2^16 is the OWASP minimum for r=8, p=1 and
    // costs roughly 100ms per hash on modern hardware. Tests lower it.
    scryptCost: integer("SCRYPT_COST", 65536, { min: 1024 }),
    maxFailedLogins: integer("MAX_FAILED_LOGINS", 5),
    lockoutMinutes: integer("LOCKOUT_MINUTES", 15),
    // Cookies are marked Secure unless explicitly relaxed for plain-HTTP
    // local development. Production ignores the override.
    secureCookies: isProduction || process.env.SECURE_COOKIES === "true",
    cookieName: process.env.REFRESH_COOKIE_NAME || "fsr_refresh",
    cookiePath: "/api/auth",
  },

  rateLimits: {
    loginPerFifteenMinutes: integer("RATE_LIMIT_LOGIN", 10),
    refreshPerFifteenMinutes: integer("RATE_LIMIT_REFRESH", 60),
    apiPerMinute: integer("RATE_LIMIT_API", 300),
  },

  // Largest accepted JSON body. Fire safety records are text, not uploads.
  bodyLimit: process.env.BODY_LIMIT || "256kb",
};

if (problems.length > 0) {
  console.error("Configuration is invalid:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nCopy backend/.env.example to backend/.env and fill it in.");
  process.exit(1);
}
