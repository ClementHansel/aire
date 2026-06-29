/**
 * DTOs for Membership Sell (Sell Pack) flow.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
 */

export interface PlateRegistrationDto {
  plate: string;
  brand?: string;
  model?: string;
}

/**
 * DTO for creating/selling a new membership.
 * Used when a Cashier sells a membership plan via Sell Pack.
 */
export interface SellMembershipDto {
  planId: string;
  customerId: string;
  orderId: string;
  tenantId: string;
}

/**
 * DTO for activating a membership after payment is confirmed.
 * Registers plates and sets the start date.
 */
export interface ActivateMembershipDto {
  plates: PlateRegistrationDto[];
}
