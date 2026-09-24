import { readFileSync } from "node:fs";
import { join } from "node:path";
import mjml2html from "mjml";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { MESSAGES } from "../constants/messages.constants";

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

const otpTemplatePath = join(__dirname, "../templates/otp-email.mjml");

async function renderOtpEmail(variables: {
  name: string;
  otp: string;
  expiryMinutes: number;
}): Promise<string> {
  const template = readFileSync(otpTemplatePath, "utf-8");
  const filled = template
    .replaceAll("{{name}}", variables.name)
    .replaceAll("{{otp}}", variables.otp)
    .replaceAll("{{expiryMinutes}}", String(variables.expiryMinutes))
    .replaceAll("{{year}}", String(new Date().getFullYear()));

  const { html, errors } = await mjml2html(filled);
  if (errors.length > 0) {
    console.error("MJML render errors:", errors);
  }
  return html;
}

export interface SendOtpEmailPayload {
  to: string;
  name: string;
  otp: string;
}

export async function sendOtpEmailNow(payload: SendOtpEmailPayload): Promise<void> {
  const html = await renderOtpEmail({
    name: payload.name,
    otp: payload.otp,
    expiryMinutes: Math.round(env.OTP_TTL_SECONDS / 60),
  });

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: payload.to,
    subject: MESSAGES.mail.otpSubject,
    html,
  });
}

export interface SendSupportAlertEmailPayload {
  subject: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Plain-text ops alert — deliberately not templated like the OTP email.
 * Used for outage/support-ticket notifications where getting the message
 * to the team fast matters more than presentation.
 */
export async function sendSupportAlertEmailNow(
  payload: SendSupportAlertEmailPayload,
): Promise<void> {
  const contextBlock = payload.context
    ? `\n\nContext:\n${JSON.stringify(payload.context, null, 2)}`
    : "";

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: env.SUPPORT_ALERT_EMAIL,
    subject: MESSAGES.mail.supportAlertSubject(payload.subject),
    text: `${payload.message}${contextBlock}`,
  });
}
