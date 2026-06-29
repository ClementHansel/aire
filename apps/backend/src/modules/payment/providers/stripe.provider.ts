import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  BackendPaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookResult,
  QRCodeData,
} from '../payment-provider.interface';

@Injectable()
export class StripeProvider implements BackendPaymentProvider {
  readonly providerName = 'stripe';
  private readonly logger = new Logger(StripeProvider.name);

  constructor(secretKey: string, private readonly webhookSecret: string) {
    // secretKey will be used for actual Stripe API calls in production
    void secretKey;
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    this.logger.log(`Creating Stripe payment for order ${params.orderId}`);
    // Stub: would call Stripe PaymentIntents API
    return {
      success: true,
      transactionId: `pi_${params.orderId}_${Date.now()}`,
      status: 'pending',
    };
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    this.logger.log(`Checking Stripe payment status: ${transactionId}`);
    // Stub: would call Stripe retrieve payment intent
    return {
      transactionId,
      status: 'pending',
      amount: 0,
    };
  }

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.validateSignature(payload, signature)) {
      return { valid: false, errorMessage: 'Invalid Stripe webhook signature' };
    }

    const data = payload as Record<string, unknown>;
    const eventType = data.type as string;
    const paymentIntent = (data.data as Record<string, unknown>)?.object as Record<string, unknown>;

    return {
      valid: true,
      transactionId: paymentIntent?.id as string,
      status: eventType === 'payment_intent.succeeded' ? 'completed' : 'failed',
    };
  }

  async generateQRCode(amount: number, orderId: string): Promise<QRCodeData> {
    this.logger.log(`Generating Stripe QR code for order ${orderId}, amount ${amount}`);
    // Stub: Stripe doesn't natively do QRIS, but included for interface compliance
    return {
      qrString: `stripe_qr_${orderId}_${amount}`,
      imageUrl: `https://api.stripe.com/qr/${orderId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  validateSignature(payload: unknown, signature: string): boolean {
    if (!signature || !this.webhookSecret) {
      return false;
    }

    // Stripe uses 't=timestamp,v1=hash' format
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const signaturePart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      return false;
    }

    const timestamp = timestampPart.slice(2);
    const providedSig = signaturePart.slice(3);

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signedPayload = `${timestamp}.${body}`;
    const expectedSig = createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
    } catch {
      return false;
    }
  }
}
