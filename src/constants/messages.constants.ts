import { formatDurationHuman } from "../utils/duration";

export const MESSAGES = {
  config: {
    invalidEnv: "Invalid environment variables",
    jwtAccessSecretTooShort: "JWT_ACCESS_SECRET must be at least 32 characters",
    jwtRefreshSecretTooShort: "JWT_REFRESH_SECRET must be at least 32 characters",
  },
  auth: {
    emailAlreadyExists: "An account with this email already exists",
    invalidCredentials: "Invalid email or password",
    authenticationRequired: "Authentication required",
    accessTokenExpired: "Access token expired",
    invalidAccessToken: "Invalid access token",
    invalidOrExpiredRefreshToken: "Invalid or expired refresh token",
    noRefreshTokenProvided: "No refresh token provided",
    userNoLongerExists: "User no longer exists",
    forbidden: "You do not have permission to perform this action",
    logoutSuccess: "Logged out successfully",
  },
  otp: {
    otpSentIfAccountExists: "If an account exists for this email, an OTP has been sent to it",
    invalidOrExpiredOtp: "Invalid or expired OTP. Please request a new one",
    tooManyFailedAttempts: "Too many failed attempts. Please request a new OTP",
    passwordResetSuccess: "Your password has been reset successfully",
  },
  rateLimit: {
    tooManyRequests: (retryAfterSeconds: number): string =>
      `Too many requests. Please try again in ${formatDurationHuman(retryAfterSeconds)}.`,
  },
  profile: {
    updated: "Profile updated successfully",
  },
  validation: {
    validationFailed: "Validation failed",
  },
  server: {
    internalError: "Internal server error",
    routeNotFound: (method: string, url: string): string => `Route not found: ${method} ${url}`,
  },
  mail: {
    otpSubject: "BookMyEvent: Your password reset code",
  },
} as const;
