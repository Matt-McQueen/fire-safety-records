// The Express application.
//
// Kept separate from src/index.js so the tests can drive it without opening a
// listening socket.
//
// The order below matters and is deliberate: security headers, then a request
// id, then CORS, then body parsing and cookies, then the rate limit, then the
// routes, and the error handler last. Anything that refuses a request should
// refuse it before the request has cost anything.

import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "./config/env.js";
import { buildApiRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./http/errorHandler.js";
import { forbidden, tooManyRequests } from "./http/errors.js";

export function createApp() {
  const app = express();

  // Behind a proxy (a container platform, a load balancer) req.ip and the
  // Secure cookie decision depend on X-Forwarded-*. Trusting one hop is right
  // for the usual single-proxy deployment; trusting every hop would let a
  // client forge its own address and defeat the rate limiter.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // This API returns JSON and serves no HTML, so the browser protections that
  // matter are the ones that stop a response being treated as a document.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );

  // One id per request, echoed in every error and written to the audit trail,
  // so a report of "it failed" can be traced to the exact request.
  app.use((req, res, next) => {
    req.id = req.get("x-request-id")?.slice(0, 64) ?? crypto.randomUUID();
    res.set("X-Request-Id", req.id);
    next();
  });

  // An allowlist, not a wildcard: credentials are involved, so the origin has
  // to be named. Requests with no Origin (curl, server-to-server) are allowed
  // through — CORS is a browser control and there is nothing to protect there.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        callback(forbidden(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  // A blanket ceiling on request volume. The login and refresh endpoints have
  // their own, much tighter, limits on top of this one.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: config.rateLimits.apiPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      // Per account once authenticated, per address before that, so one busy
      // client cannot exhaust the allowance of everyone behind the same NAT.
      // ipKeyGenerator collapses an IPv6 address to its /64 prefix; without it
      // a client with a routed IPv6 range gets a fresh allowance per address.
      keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`),
      handler: (req, res, next) => next(tooManyRequests()),
      skip: () => config.isTest,
    }),
  );

  app.use("/api", buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
