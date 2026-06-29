import { VoucherType } from '../enums';

/**
 * Voucher validation request body.
 * POST /api/vouchers/validate
 */
export interface ValidateVoucherRequest {
  code: string;
  orderId?: string;
}

/**
 * Voucher validation response.
 * POST /api/vouchers/validate
 */
export interface ValidateVoucherResponse {
  valid: boolean;
  type: VoucherType;
  discountValue: number;
  /** Whether voucher conditions are met (outlet, brand, service, min order) */
  applicable: boolean;
  /** Reason why voucher is not applicable */
  reason?: string;
  /** Warning message to display to cashier */
  warningMessage?: string;
}

/**
 * Sell voucher pack request body.
 * POST /api/voucher-packs/sell
 */
export interface SellVoucherPackRequest {
  templateId: string;
  customerId: string;
  orderId: string;
}

/**
 * Redeem voucher request body.
 * POST /api/vouchers/redeem
 */
export interface RedeemVoucherRequest {
  code: string;
  orderId: string;
}
