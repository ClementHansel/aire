import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt } from './encryption.util';
import { randomBytes } from 'crypto';

describe('encryption.util', () => {
  const TEST_KEY = randomBytes(32).toString('hex');

  beforeAll(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('should encrypt and decrypt a simple string', () => {
    const plaintext = 'hello world';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce output in {iv}:{authTag}:{ciphertext} format', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);

    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
      expect(Buffer.from(part, 'base64').length).toBeGreaterThan(0);
    }
  });

  it('should produce different ciphertext for the same plaintext (due to random IV)', () => {
    const plaintext = 'same input';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should not produce ciphertext equal to plaintext', () => {
    const plaintext = 'sensitive api key';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).not.toContain(plaintext);
  });

  it('should handle empty string', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle unicode characters', () => {
    const plaintext = '你好世界 🌍 café résumé';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle long strings', () => {
    const plaintext = 'a'.repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should throw on invalid encrypted format', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted format');
    expect(() => decrypt('a:b')).toThrow('Invalid encrypted format');
    expect(() => decrypt('a:b:c:d')).toThrow('Invalid encrypted format');
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper with ciphertext
    const tampered = parts[0] + ':' + parts[1] + ':' + Buffer.from('tampered').toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('should throw on tampered auth tag', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper with auth tag
    const fakeTag = randomBytes(16).toString('base64');
    const tampered = parts[0] + ':' + fakeTag + ':' + parts[2];
    expect(() => decrypt(tampered)).toThrow();
  });

  describe('environment variable validation', () => {
    it('should throw if SETTINGS_ENCRYPTION_KEY is not set', () => {
      const original = process.env.SETTINGS_ENCRYPTION_KEY;
      delete process.env.SETTINGS_ENCRYPTION_KEY;
      expect(() => encrypt('test')).toThrow(
        'SETTINGS_ENCRYPTION_KEY environment variable is not set',
      );
      process.env.SETTINGS_ENCRYPTION_KEY = original;
    });

    it('should throw if SETTINGS_ENCRYPTION_KEY is not 32 bytes', () => {
      const original = process.env.SETTINGS_ENCRYPTION_KEY;
      process.env.SETTINGS_ENCRYPTION_KEY = 'abcd'; // too short
      expect(() => encrypt('test')).toThrow(
        'SETTINGS_ENCRYPTION_KEY must be 32 bytes (64 hex characters)',
      );
      process.env.SETTINGS_ENCRYPTION_KEY = original;
    });
  });
});
