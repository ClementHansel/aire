import { Injectable, Logger } from '@nestjs/common';
import { BackendPaymentProvider } from './payment-provider.interface';
import { XenditProvider } from './providers/xendit.provider';
import { MidtransProvider } from './providers/midtrans.provider';
import { StripeProvider } from './providers/stripe.provider';

/**
 * Tenant-level payment provider configuration.
 * Stored in tenants.settings JSONB field.
 */
export interface TenantPaymentConfig {
  provider: 'xendit' | 'midtrans' | 'stripe';
  apiKey: string;
  webhookSecret: string;
  /** Additional provider-specific configuration */
  options?: Record<string, unknown>;
}

/**
 * Provider factory function type for creating provider instances.
 */
type ProviderFactory = (config: TenantPaymentConfig) => BackendPaymentProvider;

/**
 * Registry that resolves the correct payment provider per tenant configuration.
 * Configurable via tenant settings — no code changes required for new providers.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly factories = new Map<string, ProviderFactory>();
  private readonly providerCache = new Map<string, BackendPaymentProvider>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default provider factories for supported providers.
   */
  private registerDefaults(): void {
    this.factories.set('xendit', (config) => new XenditProvider(config.apiKey, config.webhookSecret));
    this.factories.set('midtrans', (config) => new MidtransProvider(config.apiKey, config.webhookSecret));
    this.factories.set('stripe', (config) => new StripeProvider(config.apiKey, config.webhookSecret));
  }

  /**
   * Register a new provider factory. Allows extending without code changes
   * to the registry itself.
   */
  registerProvider(name: string, factory: ProviderFactory): void {
    this.factories.set(name, factory);
    this.logger.log(`Registered payment provider factory: ${name}`);
  }

  /**
   * Get the configured payment provider for a tenant.
   * Caches provider instances per tenantId for performance.
   *
   * @param tenantId - The tenant UUID
   * @param config - Tenant's payment configuration from settings
   * @returns The payment provider instance
   * @throws Error if the provider is not registered
   */
  getProvider(tenantId: string, config: TenantPaymentConfig): BackendPaymentProvider {
    // Cache key includes provider name so config changes create new instances
    const cacheKey = `${tenantId}:${config.provider}`;

    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const factory = this.factories.get(config.provider);
    if (!factory) {
      throw new Error(
        `Payment provider "${config.provider}" is not registered. Available: ${Array.from(this.factories.keys()).join(', ')}`,
      );
    }

    const provider = factory(config);
    this.providerCache.set(cacheKey, provider);
    this.logger.log(`Created ${config.provider} provider instance for tenant ${tenantId}`);
    return provider;
  }

  /**
   * Get a provider by name (for webhook handling where we know the provider from the URL).
   * Uses a shared instance with the provided config.
   */
  getProviderByName(providerName: string, config: TenantPaymentConfig): BackendPaymentProvider {
    const factory = this.factories.get(providerName);
    if (!factory) {
      throw new Error(`Payment provider "${providerName}" is not registered.`);
    }
    return factory(config);
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Clear the provider cache (useful for config changes).
   */
  clearCache(tenantId?: string): void {
    if (tenantId) {
      for (const key of this.providerCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) {
          this.providerCache.delete(key);
        }
      }
    } else {
      this.providerCache.clear();
    }
  }
}
