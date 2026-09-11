import "dotenv/config";
import { z } from "zod";
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
  FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().default(3),
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
  FORGOT_PASSWORD_EMAIL_RATE_LIMIT_MAX: z.coerce.number().default(3),
  FORGOT_PASSWORD_EMAIL_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(3600),
  RESET_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().default(10),
  RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(3600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(MESSAGES.config.invalidEnv, z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
