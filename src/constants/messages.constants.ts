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
    registerSuccess: "Account created successfully",
    loginSuccess: "Logged in successfully",
    logoutSuccess: "Logged out successfully",
    refreshSuccess: "Session refreshed successfully",
    meFetchSuccess: "User fetched successfully",
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
    fetchSuccess: "Profile fetched successfully",
    updated: "Profile updated successfully",
  },
  events: {
    notFound: "Event not found",
    createSuccess: "Event created successfully",
    updateSuccess: "Event updated successfully",
    fetchSuccess: "Events fetched successfully",
  },
  sections: {
    notFound: "Section not found",
    tooManySeats: "A section can have at most 500 seats (rows × seats per row)",
    invalidAisle: "Aisle position must fall between two seats in the row",
    createSuccess: "Section created successfully",
    updateSuccess: "Section updated successfully",
    deleteSuccess: "Section deleted successfully",
    fetchSuccess: "Sections fetched successfully",
    reorderSuccess: "Section order updated successfully",
    invalidReorder: "The provided section list does not match this event's sections",
    cannotDeleteHeldOrBooked: "Cannot delete a section that has held or booked seats",
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
