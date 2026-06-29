import {
  PaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookResult,
  QRCodeData,
} from '@aire/shared';

/**
 * Extended payment provider interface for backend implementations.
 * Adds provider identification and webhook signature validation.
 */
export interface BackendPaymentProvider extends PaymentProvider {
  /** Unique provider identifier (e.g., 'xendit', 'midtrans', 'stripe') */
  readonly providerName: string;

  /**
   * Validates the webhook signature for this provider.
   * @returns true if signature is valid
   */
  validateSignature(payload: unknown, signature: string): boolean;
}

export type {
  PaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookResult,
  QRCodeData,
};
