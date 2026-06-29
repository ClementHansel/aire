import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { XenditProvider } from './providers/xendit.provider';
import { MidtransProvider } from './providers/midtrans.provider';
import { StripeProvider } from './providers/stripe.provider';
import { PaymentWebhookController, WebhookConfigResolver } from './payment-webhook.controller';
import { PaymentProviderRegistry, TenantPaymentConfig } from './payment-provider.registry';

/**
 * Property-Based Test: Webhook Signature Rejection (Property 26)
 *
 * **Validates: Requirements 9.4**
 *
 * Properties:
 * - For any payload with a random (non-matching) signature: validateSignature returns false for ALL providers
 * - For any payload with empty/null signature: validateSignature returns false
 * - For any payload with the correct computed signature: validateSignature returns true
 * - Signature validation is deterministic: same inputs always produce same result
 * - Invalid signature never causes handleWebhook to return valid=true
 */

// --- Arbitraries ---

/** Arbitrary JSON-serializable payload objects */
const payloadArbitrary = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  ),
  { minKeys: 1, maxKeys: 10 },
);

/** Arbitrary non-empty webhook secrets */
const secretArbitrary = fc.string({ minLength: 8, maxLength: 64 }).filter((s) => s.length >= 8);

/** Arbitrary signatures that will NOT match (random hex-like strings) */
const invalidSignatureArbitrary = fc.hexaString({ minLength: 32, maxLength: 128 });

/** Arbitrary empty or null-like signatures */
const emptySignatureArbitrary = fc.constantFrom('', undefined as unknown as string, null as unknown as string);

// --- Provider factories for testing ---

function createXenditProvider(secret: string): XenditProvider {
  return new XenditProvider('test_api_key', secret);
}

function createMidtransProvider(secret: string): MidtransProvider {
  return new MidtransProvider('test_server_key', secret);
}

function createStripeProvider(secret: string): StripeProvider {
  return new StripeProvider('test_secret_key', secret);
}

// --- Correct signature computation helpers ---

function computeXenditSignature(payload: unknown, secret: string): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', secret).update(body).digest('hex');
}

function computeMidtransSignature(payload: unknown, secret: string): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha512', secret).update(body).digest('hex');
}

function computeStripeSignature(payload: unknown, secret: string, timestamp?: string): string {
  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${ts}.${body}`;
  const sig = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${ts},v1=${sig}`;
}

// ============================================================
// PROPERTY TESTS
// ============================================================

describe('Property 26: Webhook Signature Rejection', () => {
  describe('For any payload with a random (non-matching) signature: validateSignature returns false for ALL providers', () => {
    it('XenditProvider rejects random signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, randomSig) => {
            const provider = createXenditProvider(secret);
            // Ensure the random sig is NOT the correct one (astronomically unlikely but be safe)
            const correctSig = computeXenditSignature(payload, secret);
            if (randomSig === correctSig) return; // skip this case

            expect(provider.validateSignature(payload, randomSig)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('MidtransProvider rejects random signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, randomSig) => {
            const provider = createMidtransProvider(secret);
            const correctSig = computeMidtransSignature(payload, secret);
            if (randomSig === correctSig) return;

            expect(provider.validateSignature(payload, randomSig)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('StripeProvider rejects random signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, randomSig) => {
            const provider = createStripeProvider(secret);

            expect(provider.validateSignature(payload, randomSig)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('For any payload with empty/null signature: validateSignature returns false', () => {
    it('XenditProvider rejects empty/null signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          emptySignatureArbitrary,
          (payload, secret, emptySig) => {
            const provider = createXenditProvider(secret);
            expect(provider.validateSignature(payload, emptySig)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('MidtransProvider rejects empty/null signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          emptySignatureArbitrary,
          (payload, secret, emptySig) => {
            const provider = createMidtransProvider(secret);
            expect(provider.validateSignature(payload, emptySig)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('StripeProvider rejects empty/null signatures', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          emptySignatureArbitrary,
          (payload, secret, emptySig) => {
            const provider = createStripeProvider(secret);
            expect(provider.validateSignature(payload, emptySig)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('For any payload with the correct computed signature: validateSignature returns true', () => {
    it('XenditProvider accepts correct signatures', () => {
      fc.assert(
        fc.property(payloadArbitrary, secretArbitrary, (payload, secret) => {
          const provider = createXenditProvider(secret);
          const correctSig = computeXenditSignature(payload, secret);

          expect(provider.validateSignature(payload, correctSig)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('MidtransProvider accepts correct signatures', () => {
      fc.assert(
        fc.property(payloadArbitrary, secretArbitrary, (payload, secret) => {
          const provider = createMidtransProvider(secret);
          const correctSig = computeMidtransSignature(payload, secret);

          expect(provider.validateSignature(payload, correctSig)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('StripeProvider accepts correct signatures', () => {
      fc.assert(
        fc.property(payloadArbitrary, secretArbitrary, (payload, secret) => {
          const provider = createStripeProvider(secret);
          const correctSig = computeStripeSignature(payload, secret);

          expect(provider.validateSignature(payload, correctSig)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Signature validation is deterministic: same inputs always produce same result', () => {
    it('XenditProvider returns same result for same inputs', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, sig) => {
            const provider = createXenditProvider(secret);
            const result1 = provider.validateSignature(payload, sig);
            const result2 = provider.validateSignature(payload, sig);
            const result3 = provider.validateSignature(payload, sig);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('MidtransProvider returns same result for same inputs', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, sig) => {
            const provider = createMidtransProvider(secret);
            const result1 = provider.validateSignature(payload, sig);
            const result2 = provider.validateSignature(payload, sig);
            const result3 = provider.validateSignature(payload, sig);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('StripeProvider returns same result for same inputs', () => {
      fc.assert(
        fc.property(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          (payload, secret, sig) => {
            const provider = createStripeProvider(secret);
            const result1 = provider.validateSignature(payload, sig);
            const result2 = provider.validateSignature(payload, sig);
            const result3 = provider.validateSignature(payload, sig);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('Invalid signature never causes handleWebhook to return valid=true', () => {
    it('XenditProvider handleWebhook returns valid=false for invalid signatures', async () => {
      await fc.assert(
        fc.asyncProperty(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          async (payload, secret, randomSig) => {
            const provider = createXenditProvider(secret);
            const correctSig = computeXenditSignature(payload, secret);
            if (randomSig === correctSig) return;

            const result = await provider.handleWebhook(payload, randomSig);
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('MidtransProvider handleWebhook returns valid=false for invalid signatures', async () => {
      await fc.assert(
        fc.asyncProperty(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          async (payload, secret, randomSig) => {
            const provider = createMidtransProvider(secret);
            const correctSig = computeMidtransSignature(payload, secret);
            if (randomSig === correctSig) return;

            const result = await provider.handleWebhook(payload, randomSig);
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('StripeProvider handleWebhook returns valid=false for invalid signatures', async () => {
      await fc.assert(
        fc.asyncProperty(
          payloadArbitrary,
          secretArbitrary,
          invalidSignatureArbitrary,
          async (payload, secret, randomSig) => {
            const provider = createStripeProvider(secret);

            const result = await provider.handleWebhook(payload, randomSig);
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('PaymentWebhookController throws UnauthorizedException for invalid signatures', async () => {
      const webhookSecret = 'test_controller_secret_123';
      const registry = new PaymentProviderRegistry();
      const configResolver = new WebhookConfigResolver();

      vi.spyOn(configResolver, 'resolveConfig').mockImplementation(
        async (providerName: string) => {
          const configs: Record<string, TenantPaymentConfig> = {
            xendit: { provider: 'xendit', apiKey: 'key', webhookSecret },
            midtrans: { provider: 'midtrans', apiKey: 'key', webhookSecret },
            stripe: { provider: 'stripe', apiKey: 'key', webhookSecret },
          };
          return configs[providerName] || null;
        },
      );

      const controller = new PaymentWebhookController(registry, configResolver);

      await fc.assert(
        fc.asyncProperty(
          payloadArbitrary,
          invalidSignatureArbitrary,
          async (payload, randomSig) => {
            // Ensure it's not accidentally valid
            const correctXenditSig = computeXenditSignature(payload, webhookSecret);
            if (randomSig === correctXenditSig) return;

            await expect(
              controller.handleXenditWebhook(payload, randomSig),
            ).rejects.toThrow(UnauthorizedException);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
