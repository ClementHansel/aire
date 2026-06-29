import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentProviderRegistry, TenantPaymentConfig } from './payment-provider.registry';

describe('PaymentProviderRegistry', () => {
  let registry: PaymentProviderRegistry;

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
  });

  describe('getProvider', () => {
    it('should return a Xendit provider for tenant configured with xendit', () => {
      const config: TenantPaymentConfig = {
        provider: 'xendit',
        apiKey: 'xnd_test_key',
        webhookSecret: 'xnd_webhook_secret',
      };

      const provider = registry.getProvider('tenant-001', config);

      expect(provider).toBeDefined();
      expect(provider.providerName).toBe('xendit');
    });

    it('should return a Midtrans provider for tenant configured with midtrans', () => {
      const config: TenantPaymentConfig = {
        provider: 'midtrans',
        apiKey: 'mid_server_key',
        webhookSecret: 'mid_webhook_secret',
      };

      const provider = registry.getProvider('tenant-002', config);

      expect(provider).toBeDefined();
      expect(provider.providerName).toBe('midtrans');
    });

    it('should return a Stripe provider for tenant configured with stripe', () => {
      const config: TenantPaymentConfig = {
        provider: 'stripe',
        apiKey: 'sk_test_key',
        webhookSecret: 'whsec_test',
      };

      const provider = registry.getProvider('tenant-003', config);

      expect(provider).toBeDefined();
      expect(provider.providerName).toBe('stripe');
    });

    it('should cache provider instances for the same tenant+provider', () => {
      const config: TenantPaymentConfig = {
        provider: 'xendit',
        apiKey: 'xnd_test_key',
        webhookSecret: 'xnd_webhook_secret',
      };

      const provider1 = registry.getProvider('tenant-001', config);
      const provider2 = registry.getProvider('tenant-001', config);

      expect(provider1).toBe(provider2);
    });

    it('should return different instances for different tenants', () => {
      const config: TenantPaymentConfig = {
        provider: 'xendit',
        apiKey: 'xnd_test_key',
        webhookSecret: 'xnd_webhook_secret',
      };

      const provider1 = registry.getProvider('tenant-001', config);
      const provider2 = registry.getProvider('tenant-002', config);

      expect(provider1).not.toBe(provider2);
      expect(provider1.providerName).toBe('xendit');
      expect(provider2.providerName).toBe('xendit');
    });

    it('should throw an error for unregistered provider', () => {
      const config = {
        provider: 'unknown_provider' as any,
        apiKey: 'key',
        webhookSecret: 'secret',
      };

      expect(() => registry.getProvider('tenant-001', config)).toThrow(
        'Payment provider "unknown_provider" is not registered',
      );
    });
  });

  describe('registerProvider', () => {
    it('should allow registering custom provider factories', () => {
      const customProvider = {
        providerName: 'custom',
        createPayment: async () => ({ success: true, transactionId: 'custom_1', status: 'pending' as const }),
        checkStatus: async () => ({ transactionId: 'custom_1', status: 'pending' as const, amount: 0 }),
        handleWebhook: async () => ({ valid: true }),
        validateSignature: () => true,
      };

      registry.registerProvider('custom', () => customProvider);

      const config: TenantPaymentConfig = {
        provider: 'custom' as any,
        apiKey: 'custom_key',
        webhookSecret: 'custom_secret',
      };

      const provider = registry.getProvider('tenant-001', config);
      expect(provider.providerName).toBe('custom');
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered providers', () => {
      expect(registry.hasProvider('xendit')).toBe(true);
      expect(registry.hasProvider('midtrans')).toBe(true);
      expect(registry.hasProvider('stripe')).toBe(true);
    });

    it('should return false for unregistered providers', () => {
      expect(registry.hasProvider('paypal')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear cache for a specific tenant', () => {
      const config: TenantPaymentConfig = {
        provider: 'xendit',
        apiKey: 'key',
        webhookSecret: 'secret',
      };

      const provider1 = registry.getProvider('tenant-001', config);
      registry.clearCache('tenant-001');
      const provider2 = registry.getProvider('tenant-001', config);

      expect(provider1).not.toBe(provider2);
    });

    it('should clear all cache when no tenantId provided', () => {
      const config: TenantPaymentConfig = {
        provider: 'xendit',
        apiKey: 'key',
        webhookSecret: 'secret',
      };

      const p1 = registry.getProvider('tenant-001', config);
      const p2 = registry.getProvider('tenant-002', config);
      registry.clearCache();
      const p1After = registry.getProvider('tenant-001', config);
      const p2After = registry.getProvider('tenant-002', config);

      expect(p1).not.toBe(p1After);
      expect(p2).not.toBe(p2After);
    });
  });
});
