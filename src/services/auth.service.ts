import { prisma } from "../lib/prisma";
import type { Role } from "../../generated/prisma/client";
import { REFRESH_TOKEN_TTL_SECONDS } from "../config/auth";
import { MESSAGES } from "../constants/messages.constants";
import { enqueueOtpEmail } from "../queues/mail.queue";
import { generateOtp, simulateOtpIssuance, storeOtp, verifyAndConsumeOtp } from "./otp.service";
import { ApiError } from "../utils/ApiError";
import { comparePassword, hashPassword } from "../utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from "../utils/jwt";
import type { RegisterInput } from "../validation/auth.schema";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

function toPublicUser(user: { id: string; name: string; email: string; role: Role }): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, MESSAGES.auth.emailAlreadyExists);
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: passwordHash,
      role: input.role,
    },
  });

  return toPublicUser(user);
}

export async function validateCredentials(email: string, password: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiError(401, MESSAGES.auth.invalidCredentials);
  }

  const isValid = await comparePassword(password, user.password);
  if (!isValid) {
    throw new ApiError(401, MESSAGES.auth.invalidCredentials);
  }

  return toPublicUser(user);
}

export async function issueTokens(userId: string, role: Role): Promise<AuthTokens> {
  const refreshTokenRecord = await prisma.refreshToken.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });

  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId, jti: refreshTokenRecord.id });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(
  token: string,
): Promise<AuthTokens & { user: PublicUser }> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, MESSAGES.auth.invalidOrExpiredRefreshToken);
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
    include: { user: true },
  });

  if (
    !stored ||
    stored.userId !== payload.sub ||
    stored.revokedAt !== null ||
    stored.expiresAt < new Date()
  ) {
    throw new ApiError(401, MESSAGES.auth.invalidOrExpiredRefreshToken);
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(stored.user.id, stored.user.role);

  return { ...tokens, user: toPublicUser(stored.user) };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return;
  }

  await prisma.refreshToken.updateMany({
    where: { id: payload.jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getUserById(id: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new ApiError(401, MESSAGES.auth.userNoLongerExists);
  }
  return toPublicUser(user);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Do equivalent-cost work so the response doesn't leak, via timing,
    // whether this email belongs to a real account.
    await simulateOtpIssuance(email);
    return;
  }

  const otp = generateOtp();
  await storeOtp(email, otp);
  await enqueueOtpEmail({ to: user.email, name: user.name, otp });
}

export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  await verifyAndConsumeOtp(email, otp);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiError(400, MESSAGES.otp.invalidOrExpiredOtp);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
