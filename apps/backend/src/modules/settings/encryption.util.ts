import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Retrieves the encryption key from the SETTINGS_ENCRYPTION_KEY environment variable.
 * The key must be 32 bytes, hex-encoded (64 hex characters).
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY environment variable is not set',
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY must be 32 bytes (64 hex characters)',
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns the encrypted value in the format: {iv}:{authTag}:{ciphertext} (all base64).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypts an encrypted string in the format: {iv}:{authTag}:{ciphertext} (all base64).
 * Returns the original plaintext string.
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted format. Expected {iv}:{authTag}:{ciphertext}',
    );
  }

  const [ivBase64, authTagBase64, ciphertextBase64] = parts;
  const iv = Buffer.from(ivBase64!, 'base64');
  const authTag = Buffer.from(authTagBase64!, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64!, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
