import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = "ENC:";

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns "ENC:" + base64(iv + ciphertext + authTag).
 */
export function encryptString(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return ENCRYPTED_PREFIX + combined.toString("base64");
}

/**
 * Decrypt a string produced by encryptString().
 * Returns null if the input is not encrypted (legacy plaintext) or decryption fails.
 */
export function decryptString(encoded: string, key: Buffer): string | null {
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) {
    return null;
  }

  try {
    const combined = Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), "base64");
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      return null;
    }
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Check if a value is encrypted (starts with the encrypted prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Derive a 32-byte key from a raw string using SHA-256.
 * Allows the encryption key to be stored as a hex string and converted back.
 */
export function deriveKey(rawKey: string): Buffer {
  return createHash("sha256").update(rawKey).digest();
}
