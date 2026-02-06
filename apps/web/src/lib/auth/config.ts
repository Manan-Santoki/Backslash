export const authConfig = {
  sessionExpiryDays: parseInt(process.env.SESSION_EXPIRY_DAYS || "7", 10),
  disableSignup: process.env.DISABLE_SIGNUP === "true",
  bcryptRounds: 10,
  cookieName: "session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  },
};
