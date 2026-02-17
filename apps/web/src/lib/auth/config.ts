export function shouldUseSecureCookies(): boolean {
  return process.env.SECURE_COOKIES === "true" ||
    (process.env.NODE_ENV === "production" && process.env.SECURE_COOKIES !== "false");
}

export const authConfig = {
  sessionExpiryDays: parseInt(process.env.SESSION_EXPIRY_DAYS || "7", 10),
  disableSignup: process.env.DISABLE_SIGNUP === "true",
  bcryptRounds: 10,
  cookieName: "session",
  cookieOptions: {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
  },
};
