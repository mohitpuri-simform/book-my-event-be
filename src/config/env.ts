import dotenv from "dotenv";
import { z } from "zod";

// NODE_ENV must already be "test" by the time this runs (vitest.config.ts
// sets it) so tests load .env.test instead of .env — resetState() in
// tests/helpers/db.ts wipes every table and flushes Redis before each test,
// and must never touch the dev database/Redis instance.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });
import { MESSAGES } from "../constants/messages.constants";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.url(),
  CLIENT_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32, MESSAGES.config.jwtAccessSecretTooShort),
  JWT_REFRESH_SECRET: z.string().min(32, MESSAGES.config.jwtRefreshSecretTooShort),
  REDIS_URL: z.url(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string(),
  OTP_TTL_SECONDS: z.coerce.number().default(600),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().default(5),

  HOLD_TTL_SECONDS: z.coerce.number().default(300),

  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),

  // Basis points of gross the platform keeps as commission on every
  // booking (500 = 5%) — see wallet.service.ts.
  STRIPE_CONNECT_PLATFORM_FEE_BPS: z.coerce.number().default(500),
  STRIPE_CONNECT_ONBOARDING_RETURN_URL: z.url(),
  STRIPE_CONNECT_ONBOARDING_REFRESH_URL: z.url(),

  SUPPORT_ALERT_EMAIL: z.string(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(MESSAGES.config.invalidEnv, z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
