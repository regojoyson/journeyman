import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.JM_SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error("JM_SECRET_ENCRYPTION_KEY env var missing");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < 32) throw new Error("JM_SECRET_ENCRYPTION_KEY must be 64 hex chars or ≥32 chars");
  return createHash("sha256").update(raw).digest();
}

export interface Sealed { ciphertext: Buffer; iv: Buffer; authTag: Buffer; }

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function open(s: Sealed): string {
  const decipher = createDecipheriv(ALGO, key(), s.iv);
  decipher.setAuthTag(s.authTag);
  return Buffer.concat([decipher.update(s.ciphertext), decipher.final()]).toString("utf8");
}
