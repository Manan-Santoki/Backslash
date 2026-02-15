import { SignJWT, jwtVerify } from "jose";

const SESSION_ALG = "HS256";
const SESSION_TOKEN_USE = "session";

export interface SessionJwtClaims {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

export interface VerifiedSessionJwt {
  userId: string;
  sessionId: string;
  exp: number | null;
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET ||
    "change-me-to-a-random-64-char-string";
  return new TextEncoder().encode(secret);
}

export async function signSessionJwt(
  claims: SessionJwtClaims
): Promise<string> {
  return new SignJWT({
    use: SESSION_TOKEN_USE,
    sid: claims.sessionId,
  })
    .setProtectedHeader({ alg: SESSION_ALG, typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(claims.expiresAt.getTime() / 1000))
    .sign(getSessionSecret());
}

export async function verifySessionJwt(
  token: string
): Promise<VerifiedSessionJwt | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: [SESSION_ALG],
    });

    const userId = payload.sub;
    const sessionId = payload.sid;
    const tokenUse = payload.use;

    if (typeof userId !== "string") return null;
    if (typeof sessionId !== "string") return null;
    if (tokenUse !== SESSION_TOKEN_USE) return null;

    return {
      userId,
      sessionId,
      exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return null;
  }
}
