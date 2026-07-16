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
  OrderVoided = 'order.voided',
  RefundIssued = 'order.refund_issued',
  // Payments
  PaymentCharged = 'payment.charged',
  PaymentConfirmed = 'payment.confirmed',
  // Memberships
  MembershipSold = 'membership.sold',
  MembershipActivated = 'membership.activated',
  MembershipEnteredGrace = 'membership.entered_grace',
  MembershipRevoked = 'membership.revoked',
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
  StockOpnameClosed = 'inventory.opname_closed',
  // Procurement
  SupplierCreated = 'procurement.supplier_created',
  PurchaseOrderCreated = 'procurement.po_created',
  GoodsReceived = 'procurement.goods_received',
  // Commission
  CommissionAccrued = 'commission.accrued',
  // Customer feedback
  FeedbackRequested = 'feedback.requested',
  FeedbackReceived = 'feedback.received',
  FeedbackAlert = 'feedback.alert',
  // Marketing broadcast
  BroadcastStarted = 'broadcast.started',
  BroadcastProgress = 'broadcast.progress',
  BroadcastCompleted = 'broadcast.completed',
  // Tax invoice (e-Faktur)
  TaxInvoiceIssued = 'tax.invoice_issued',
  // Finance
  ExpenseRecorded = 'finance.expense_recorded',
  // Settlement (inter-branch)
  SettlementAccrued = 'settlement.accrued',
  SettlementPaidOut = 'settlement.paid_out',
  // Sales
  SalesLeadCreated = 'sales.lead_created',
  SalesLeadStatusChanged = 'sales.lead_status_changed',
  SalesTargetSet = 'sales.target_set',
  // HR
  EmployeeAdded = 'hr.employee_added',
  AttendanceRecorded = 'hr.attendance_recorded',
  LeaveRequested = 'hr.leave_requested',
  LeaveResolved = 'hr.leave_resolved',
  // POS shifts
  ShiftOpened = 'shift.opened',
  ShiftClosed = 'shift.closed',
  PettyCashRecorded = 'shift.petty_cash_recorded',
  ShiftIssueReported = 'shift.issue_reported',
  // HR / Payroll
  ScheduleSet = 'hr.schedule_set',
  Clocked = 'hr.clocked',
  HolidayAdded = 'hr.holiday_added',
  PayrollAdjustmentAdded = 'hr.payroll_adjustment_added',
  LoanCreated = 'hr.loan_created',
  LoanRepaid = 'hr.loan_repaid',
  PayrollGenerated = 'hr.payroll_generated',
  PayrollFinalized = 'hr.payroll_finalized',
  // Branch devices / IoT edge (topology + AI monitoring alerts)
  DeviceOffline = 'device.offline',
  DeviceOnline = 'device.online',
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
