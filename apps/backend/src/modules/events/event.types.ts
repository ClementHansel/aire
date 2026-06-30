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
  // Inventory
  InventoryItemCreated = 'inventory.item_created',
  InventoryStockAdjusted = 'inventory.stock_adjusted',
  InventoryLowStock = 'inventory.low_stock',
  // Procurement
  SupplierCreated = 'procurement.supplier_created',
  PurchaseOrderCreated = 'procurement.po_created',
  PurchaseOrderReceived = 'procurement.po_received',
  // Finance
  ExpenseRecorded = 'finance.expense_recorded',
  // Sales
  SalesLeadCreated = 'sales.lead_created',
  SalesLeadStatusChanged = 'sales.lead_status_changed',
  SalesTargetSet = 'sales.target_set',
  // HR
  EmployeeAdded = 'hr.employee_added',
  AttendanceRecorded = 'hr.attendance_recorded',
  LeaveRequested = 'hr.leave_requested',
  LeaveResolved = 'hr.leave_resolved',
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
