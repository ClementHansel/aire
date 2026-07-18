import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PaymentWebhookController, WebhookConfigResolver } from './payment-webhook.controller';
import { PaymentProviderRegistry, TenantPaymentConfig } from './payment-provider.registry';

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let registry: PaymentProviderRegistry;
  let configResolver: WebhookConfigResolver;
  let paymentService: { confirmPaymentByReference: ReturnType<typeof vi.fn> };

  const xenditSecret = 'xnd_webhook_secret_test';
  const midtransSecret = 'mid_webhook_secret_test';
  const stripeSecret = 'whsec_test_secret';

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
    // Real resolver deps aren't exercised here — resolveConfig is spied below.
    configResolver = new WebhookConfigResolver({ query: vi.fn() } as never, {} as never);
    paymentService = { confirmPaymentByReference: vi.fn().mockResolvedValue(true) };

    // Override configResolver to return known secrets
    vi.spyOn(configResolver, 'resolveConfig').mockImplementation(
      async (providerName: string) => {
        const configs: Record<string, TenantPaymentConfig> = {
          xendit: { provider: 'xendit', apiKey: 'xnd_key', webhookSecret: xenditSecret },
          midtrans: { provider: 'midtrans', apiKey: 'mid_key', webhookSecret: midtransSecret },
          stripe: { provider: 'stripe', apiKey: 'sk_key', webhookSecret: stripeSecret },
        };
        return configs[providerName] || null;
      },
    );

    controller = new PaymentWebhookController(registry, configResolver, paymentService as never);
  });

  describe('Xendit webhook', () => {
    it('should accept valid Xendit webhook with correct signature', async () => {
      const payload = { id: 'xnd_txn_123', reference_id: 'order_123', status: 'PAID', amount: 50000 };
      // Xendit uses a static callback token, not an HMAC signature.
      const signature = xenditSecret;

      const result = await controller.handleXenditWebhook(payload, signature);

      expect(result).toEqual({
        received: true,
        transactionId: 'order_123',
        status: 'completed',
      });
    });

    it('should reject Xendit webhook with invalid signature', async () => {
      const payload = { id: 'xnd_txn_123', status: 'PAID' };

      await expect(
        controller.handleXenditWebhook(payload, 'invalid_signature'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject Xendit webhook with missing signature', async () => {
      const payload = { id: 'xnd_txn_123', status: 'PAID' };

      await expect(
        controller.handleXenditWebhook(payload, ''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject Xendit webhook with undefined signature', async () => {
      const payload = { id: 'xnd_txn_123', status: 'PAID' };

      await expect(
        controller.handleXenditWebhook(payload, undefined as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Midtrans webhook', () => {
    it('should accept valid Midtrans webhook with correct signature', async () => {
      const payload = { transaction_id: 'mid_txn_456', transaction_status: 'settlement' };
      const body = JSON.stringify(payload);
      const signature = createHmac('sha512', midtransSecret).update(body).digest('hex');

      const result = await controller.handleMidtransWebhook(payload, signature);

      expect(result).toEqual({
        received: true,
        transactionId: 'mid_txn_456',
        status: 'completed',
      });
    });

    it('should reject Midtrans webhook with invalid signature', async () => {
      const payload = { transaction_id: 'mid_txn_456', transaction_status: 'settlement' };

      await expect(
        controller.handleMidtransWebhook(payload, 'wrong_sig'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject Midtrans webhook with empty signature', async () => {
      const payload = { transaction_id: 'mid_txn_456' };

      await expect(
        controller.handleMidtransWebhook(payload, ''),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Stripe webhook', () => {
    it('should accept valid Stripe webhook with correct signature', async () => {
      const payload = {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_789' } },
      };
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify(payload);
      const signedPayload = `${timestamp}.${body}`;
      const sig = createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
      const signature = `t=${timestamp},v1=${sig}`;

      const result = await controller.handleStripeWebhook(payload, signature);

      expect(result).toEqual({
        received: true,
        transactionId: 'pi_789',
        status: 'completed',
      });
    });

    it('should reject Stripe webhook with invalid signature', async () => {
      const payload = {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_789' } },
      };
      const signature = 't=12345,v1=invalid_hash';

      await expect(
        controller.handleStripeWebhook(payload, signature),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject Stripe webhook with malformed signature format', async () => {
      const payload = {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_789' } },
      };

      await expect(
        controller.handleStripeWebhook(payload, 'not_stripe_format'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject Stripe webhook with missing signature', async () => {
      const payload = { type: 'payment_intent.succeeded' };

      await expect(
        controller.handleStripeWebhook(payload, ''),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Config resolution failure', () => {
    it('should reject webhook when config cannot be resolved', async () => {
      vi.spyOn(configResolver, 'resolveConfig').mockResolvedValueOnce(null);

      const payload = { id: 'test' };

      await expect(
        controller.handleXenditWebhook(payload, 'some_sig'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // Multi-tenant hardening: the resolver maps a webhook back to the OWNING tenant
  // by the order reference in the payload, then returns THAT tenant's config.
  describe('WebhookConfigResolver (tenant resolution)', () => {
    let mockPool: { query: ReturnType<typeof vi.fn> };
    let mockPayment: { getTenantPaymentConfig: ReturnType<typeof vi.fn> };
    let resolver: WebhookConfigResolver;

    beforeEach(() => {
      mockPool = { query: vi.fn() };
      mockPayment = {
        getTenantPaymentConfig: vi.fn().mockResolvedValue({
          provider: 'xendit', apiKey: 'tenant_key', webhookSecret: 'tenant_secret',
        }),
      };
      resolver = new WebhookConfigResolver(mockPool as never, mockPayment as never);
    });

    it('resolves the owning tenant from a Xendit reference_id and returns their config', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-42' }] });
      const cfg = await resolver.resolveConfig('xendit', {
        event: 'qr.payment', data: { reference_id: 'order-abc', status: 'PAID' },
      });
      // Looked up the order by the extracted reference, then loaded that tenant's config.
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toContain('order-abc');
      expect(mockPayment.getTenantPaymentConfig).toHaveBeenCalledWith('tenant-42');
      expect(cfg?.webhookSecret).toBe('tenant_secret');
    });

    it('resolves from a Stripe metadata.order_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-7' }] });
      await resolver.resolveConfig('stripe', {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', metadata: { order_id: 'order-xyz' } } },
      });
      const [, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toContain('order-xyz');
      expect(params[0]).toContain('pi_1');
      expect(mockPayment.getTenantPaymentConfig).toHaveBeenCalledWith('tenant-7');
    });

    it('returns null (fail closed) when no order matches', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const cfg = await resolver.resolveConfig('midtrans', { order_id: 'ghost' });
      expect(cfg).toBeNull();
      expect(mockPayment.getTenantPaymentConfig).not.toHaveBeenCalled();
    });

    it('returns null when the payload carries no reference at all', async () => {
      const cfg = await resolver.resolveConfig('xendit', { event: 'ping' });
      expect(cfg).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });
});
