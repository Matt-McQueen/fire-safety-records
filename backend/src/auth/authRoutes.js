// /api/auth — the only endpoints reachable without an access token.
//
// Login and refresh are open by necessity; everything after them requires one.
// Both are rate limited, because they are the two endpoints where guessing is
// worth an attacker's time.

import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config/env.js";
import { asyncHandler } from "../http/asyncHandler.js";
import { validateBody } from "../http/validate.js";
import { tooManyRequests } from "../http/errors.js";
import { authenticate } from "./middleware.js";
import { refreshCookieOptions } from "./tokens.js";
import * as authService from "./authService.js";

export const authRouter = Router();

// `limit` is a function rather than a number so the ceiling is read at request
// time. That keeps it configurable, and lets the tests exercise the limiter
// rather than having to switch it off.
const limiter = ({ limit, windowMinutes, message, perUser = false }) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      perUser && req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
    handler: (req, res, next) => next(tooManyRequests(message)),
  });

// Keyed by address, not by email: keying by email would let anyone lock a
// named account out of signing in simply by failing against it repeatedly.
const loginLimiter = limiter({
  limit: () => config.rateLimits.loginPerFifteenMinutes,
  windowMinutes: 15,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

const refreshLimiter = limiter({ limit: () => 60, windowMinutes: 15, message: "Too many refresh attempts." });

const credentials = z.strictObject({
  email: z.string().trim().min(1).max(320),
  // Not validated for shape: what matters at login is whether it matches, and
  // rejecting a password for its form here would tell an attacker about the
  // policy without them having to try.
  password: z.string().min(1).max(200),
});

authRouter.post(
  "/login",
  loginLimiter,
  validateBody(credentials),
  asyncHandler(async (req, res) => {
    const session = await authService.login({
      email: req.body.email,
      password: req.body.password,
      request: req,
    });
    sendSession(res, session);
  }),
);

authRouter.post(
  "/refresh",
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const session = await authService.refresh({
      token: req.cookies?.[config.auth.cookieName],
      request: req,
    });
    sendSession(res, session);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    // Deliberately not behind `authenticate`: signing out with an expired
    // access token must still clear the session rather than returning 401.
    await authService.logout({
      token: req.cookies?.[config.auth.cookieName],
      user: req.user,
      request: req,
    });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ data: req.user });
  }),
);

authRouter.post(
  "/change-password",
  authenticate,
  // Tighter than the login limit: a signed-in user has no reason to call this
  // often, and it is a route to guessing the current password. Keyed by
  // account, because by this point there is one.
  limiter({
    limit: () => 5,
    windowMinutes: 15,
    message: "Too many password change attempts.",
    perUser: true,
  }),
  validateBody(
    z.strictObject({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(1).max(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    await authService.changePassword({
      user: req.user,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      request: req,
    });
    // Every session is now closed, this one included.
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout({ user: req.user, request: req, everywhere: true });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

// The refresh token goes in the cookie and nowhere else — never in the body —
// so a client cannot store it somewhere script can read.
function sendSession(res, session) {
  res.cookie(config.auth.cookieName, session.refreshToken, refreshCookieOptions());
  res.json({
    data: {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    },
  });
}

function clearRefreshCookie(res) {
  const { maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(config.auth.cookieName, options);
}
