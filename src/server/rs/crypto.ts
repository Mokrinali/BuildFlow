// Encryption of the RS.ge service-user password at rest (AES-256-GCM).
// The key is derived from BETTER_AUTH_SECRET, so no extra secret is needed. Changing that secret
// makes stored passwords unreadable: the admin then enters the RS.ge password again.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "buildflow", "rs-ge-service-password", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(
    ":",
  );
}

/** Null when the value cannot be decrypted (e.g. the app secret changed). */
export function decryptSecret(stored: string): string | null {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
