import crypto from "crypto";

const PREFIX = "enc:v1:";
const KEY_INFO = "backslash/aikey-v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required to encrypt stored secrets. Set it in .env.",
    );
  }
  // scrypt is a fine one-shot KDF for deriving a stable 256-bit key from a
  // server-provided secret. Salt is a constant tag since the key is single-purpose.
  cachedKey = crypto.scryptSync(secret, KEY_INFO, 32);
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSecret(value: string): string {
  if (!value) return value;
  if (!value.startsWith(PREFIX)) {
    // Legacy plaintext row — leave as-is; next upsert re-encrypts.
    return value;
  }
  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (payload.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
