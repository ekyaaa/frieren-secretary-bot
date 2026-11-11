/**
 * Cryptographic helpers for Frieren Discord Logbook.
 * AES-256-GCM authenticated encryption for credentials and keys at rest.
 * SHA-256 hashing for tokens, pairing codes, and evidence digests.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a 32-byte key from a secret string using SHA-256.
 */
function deriveKey(secretKey: string): Buffer {
  return crypto.createHash('sha256').update(secretKey).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: "iv:authTag:ciphertext" (all hex encoded)
 */
export function encrypt(plaintext: string, secretKey: string): string {
  if (!plaintext) return '';
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a ciphertext string formatted as "iv:authTag:ciphertext".
 */
export function decrypt(encryptedData: string, secretKey: string): string {
  if (!encryptedData) return '';
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const key = deriveKey(secretKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Computes a SHA-256 hash in hex format.
 */
export function hashSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a random alphanumeric pairing code (e.g. "FR-98214").
 */
export function generatePairingCode(): string {
  const num = crypto.randomInt(10000, 99999);
  return `FR-${num}`;
}

/**
 * Generates a cryptographically random device bearer token.
 */
export function generateDeviceToken(): string {
  return `agt_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Masks a secret string (e.g., API key, password) showing only the last 4 characters.
 */
export function maskSecret(secret: string): string {
  if (!secret) return '***';
  if (secret.length <= 4) return '****';
  return `${'*'.repeat(Math.min(secret.length - 4, 8))}${secret.slice(-4)}`;
}
