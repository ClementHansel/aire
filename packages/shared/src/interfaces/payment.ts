import { PaymentMethod } from '../enums';

/**
 * Parameters for creating a payment with a provider.
 */
export interface CreatePaymentParams {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  referenceNumber?: string;
}

/**
 * Result of a payment creation attempt.
 */
export interface PaymentResult {
  success: boolean;
  transactionId: string;
  status: 'pending' | 'completed' | 'failed';
  qrCodeUrl?: string;
  errorMessage?: string;
}

/**
 * Payment status check result.
 */
export interface PaymentStatus {
  transactionId: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  paidAt?: string;
  amount: number;
}

/**
 * Webhook processing result.
 */
export interface WebhookResult {
  valid: boolean;
  transactionId?: string;
  status?: 'completed' | 'failed';
  errorMessage?: string;
}

/**
 * QR code data for QRIS payments.
 */
export interface QRCodeData {
  qrString: string;
  imageUrl: string;
  expiresAt: string;
}

/**
 * Abstract payment provider interface.
 */
export interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  checkStatus(transactionId: string): Promise<PaymentStatus>;
  handleWebhook(payload: unknown, signature: string): Promise<WebhookResult>;
  generateQRCode?(amount: number, orderId: string): Promise<QRCodeData>;
}
