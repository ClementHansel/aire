/**
 * Domain event catalog for the AIRE platform.
 *
 * Every meaningful state change in the app emits one of these events through
 * the EventBus. Events are persisted to `domain_events` (the AI's data feed +
 * monitoring source) and dispatched in-process to subscribers (e.g. the AI
 * agent's reactive analysis).
 */
export enum DomainEventType {
  // Orders
  OrderCreated = 'order.created',
  OrderPaid = 'order.paid',
  // Payments
  PaymentCharged = 'payment.charged',
  PaymentConfirmed = 'payment.confirmed',
  // Memberships
  MembershipSold = 'membership.sold',
  MembershipActivated = 'membership.activated',
  // Vouchers
  VoucherPackSold = 'voucher.pack_sold',
  VoucherPackIssued = 'voucher.pack_issued',
  VoucherRedeemed = 'voucher.redeemed',
  // Customers
  CustomerCreated = 'customer.created',
  // Agent
  AgentProposalCreated = 'agent.proposal_created',
  AgentToolExecuted = 'agent.tool_executed',
  AgentAnomalyFlagged = 'agent.anomaly_flagged',
}

/** Wildcard channel for subscribers that want every event. */
export const EVENT_WILDCARD = '*';

/** A domain event as emitted and persisted. */
export interface DomainEvent<T = Record<string, unknown>> {
  id?: string;
  type: DomainEventType | string;
  tenantId?: string | null;
  outletId?: string | null;
  payload: T;
  actor?: string | null;
  createdAt?: string;
}

/** Handler signature for event subscribers. */
export type EventHandler = (event: DomainEvent) => void | Promise<void>;
