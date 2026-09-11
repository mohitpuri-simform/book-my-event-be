import { Router } from "express";
import { env } from "../config/env";
import {
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  register,
  resetPasswordHandler,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { emailKeyResolver, rateLimiter } from "../middleware/rateLimiter";

const router = Router();

// Broad per-IP guard against a single source hammering the endpoint.
const forgotPasswordIpRateLimiter = rateLimiter({
  keyPrefix: "forgot-password-ip",
  max: env.FORGOT_PASSWORD_RATE_LIMIT_MAX,
  windowSeconds: env.FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
});

// Narrower per-email guard so an attacker can't spam one inbox from many
// IPs/proxies. Independent of the IP limit above.
const forgotPasswordEmailRateLimiter = rateLimiter({
  keyPrefix: "forgot-password-email",
  max: env.FORGOT_PASSWORD_EMAIL_RATE_LIMIT_MAX,
  windowSeconds: env.FORGOT_PASSWORD_EMAIL_RATE_LIMIT_WINDOW_SECONDS,
  keyResolver: emailKeyResolver,
});

// Per-IP guard on OTP verification, separate from the per-email failed-
// attempt lockout that otp.service.ts already enforces.
const resetPasswordRateLimiter = rateLimiter({
  keyPrefix: "reset-password-ip",
  max: env.RESET_PASSWORD_RATE_LIMIT_MAX,
  windowSeconds: env.RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
});

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);
router.post(
  "/forgot-password",
  forgotPasswordIpRateLimiter,
  forgotPasswordEmailRateLimiter,
  forgotPassword,
);
router.post("/reset-password", resetPasswordRateLimiter, resetPasswordHandler);

export default router;
