'use client';

/**
 * Shared POS payment modal — the single place that renders the "collect payment
 * for an already-created order" popup. Before this component existed,
 * new-order/page.tsx and sell-pack/page.tsx each hand-rolled their own modal and
 * had drifted: sell-pack was missing the QRIS static/dynamic toggle, the EDC/CC/
 * transfer reference-number field, and the payment-method button grid with logos
 * that new-order had (AIRIN-125).
 *
 * The modal owns payment-METHOD selection/UI and the cash-shortfall guard
 * (AIRIN-127: a cashier must not be able to confirm a cash sale for less than
 * the order total). It does NOT own the actual network call — the page still
 * runs its own confirm/QRIS-polling logic, since that differs (order pay vs
 * membership-fee pay) and is already wired per page.
 */

import { useI18n } from '@/lib/i18n';
import { PaymentSandboxNote } from '@/components/shared/PaymentSandboxNote';

export interface PaymentMethodDTO {
  id: string;
  name: string;
  kind: 'cash' | 'qris' | 'edc' | 'cc' | 'transfer';
  /** A business unit CODE, or null for tender that settles nowhere. AIRIN-176. */
  businessUnit: string | null;
  logoUrl: string | null;
  color: string;
}

export type PosPaymentMethod = 'cash' | 'qris_static' | 'qris_dynamic' | 'edc' | 'cc' | 'transfer';

/** One row in the modal's totals summary. The caller fully controls which rows
 *  appear (new-order shows subtotal/service charge/tax/voucher; sell-pack shows
 *  a single sale-name row) — `total` below is always authoritative for the
 *  cash change/shortfall math regardless of what's displayed here. */
export interface PaymentSummaryLine {
  key: string;
  label: string;
  amount: number;
  /** Renders green with a leading minus (e.g. voucher discount). */
  discount?: boolean;
  /** Bold/larger row — used for a single top-line total or the closing Total row. */
  emphasis?: boolean;
}

export interface PaymentModalProps {
  orderLabel: string;
  total: number;
  summaryLines: PaymentSummaryLine[];
  /** Post-order advisory (e.g. membership quota withheld) — optional, new-order only. */
  membershipQuotaWarning?: string;
  payMethods: PaymentMethodDTO[];
  selectedPmId: string | null;
  payMethod: PosPaymentMethod;
  /** Fired both when the cashier picks a payment-method tile/option AND when they
   *  flip the QRIS dynamic/static toggle (same pm, different resolved method). */
  onSelectMethod: (pmId: string | null, method: PosPaymentMethod) => void;
  /** Settlement account hint ("Settles to the X account") — omitted when the
   *  sale has no business-unit concept (membership/voucher sales in sell-pack). */
  businessUnit?: string | null;
  amountReceived: string;
  onAmountReceivedChange: (value: string) => void;
  referenceNumber: string;
  onReferenceNumberChange: (value: string) => void;
  qr: string | null;
  polling: boolean;
  paying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export function PaymentModal({
  orderLabel,
  total,
  summaryLines,
  membershipQuotaWarning,
  payMethods,
  selectedPmId,
  payMethod,
  onSelectMethod,
  businessUnit,
  amountReceived,
  onAmountReceivedChange,
  referenceNumber,
  onReferenceNumberChange,
  qr,
  polling,
  paying,
  onConfirm,
  onCancel,
}: PaymentModalProps) {
  const { t } = useI18n();

  const receivedNum = Number(amountReceived || 0);
  const change = Math.max(0, receivedNum - total);
  // AIRIN-127: a cashier could previously confirm an underpaid cash sale — the
  // screen just showed "Change: Rp 0" with no indication the tender fell short.
  const shortfall = Math.max(0, total - receivedNum);
  const cashInsufficient = payMethod === 'cash' && !qr && shortfall > 0;
  const referenceMissing = (payMethod === 'edc' || payMethod === 'cc' || payMethod === 'transfer') && !referenceNumber.trim();
  const confirmDisabled = paying || cashInsufficient || referenceMissing;

  const settlesTo = payMethods.find((m) => m.id === selectedPmId)?.businessUnit ?? businessUnit;
  // The dynamic/static toggle only makes sense once a single "QRIS" pm tile has
  // been picked from the DB list — the static <select> fallback already lists
  // dynamic and static as two separate options.
  const showQrisToggle = (payMethod === 'qris_dynamic' || payMethod === 'qris_static') &&
    payMethods.some((m) => m.id === selectedPmId && m.kind === 'qris');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="payment-modal">
      <div className="card w-full max-w-md">
        <h3 className="section-title">{orderLabel}</h3>
        <PaymentSandboxNote className="mt-3" />

        {membershipQuotaWarning && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
            ⚠️ {membershipQuotaWarning}
          </div>
        )}

        <div className="mt-4 space-y-2 text-sm">
          {summaryLines.map((line) => (
            <div
              key={line.key}
              className={`flex justify-between ${line.emphasis ? 'text-base font-semibold border-t border-border pt-2 mt-2' : ''}`}
            >
              <span className={line.emphasis ? '' : 'text-text-secondary'}>{line.label}</span>
              <span className={line.discount ? 'text-green-600' : line.emphasis ? 'text-primary-600' : ''}>
                {line.discount ? '−' : ''}{fmt(Math.abs(line.amount))}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1.5">{t('pos.payment.method', 'Payment Method')}</label>
          {payMethods.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {payMethods.map((pm) => {
                // A "qris" payment method covers both dynamic (gateway) and static
                // (printed/sticker) flows — default to dynamic; the toggle below
                // lets the cashier switch to static for this same method.
                const mapped: PosPaymentMethod = pm.kind === 'qris' ? 'qris_dynamic' : pm.kind;
                const active = selectedPmId === pm.id;
                return (
                  <button
                    key={pm.id}
                    type="button"
                    disabled={polling}
                    onClick={() => onSelectMethod(pm.id, mapped)}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-primary-500 ring-2 ring-primary-100' : 'border-border hover:border-border-strong'}`}
                  >
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: pm.color }}>
                      {pm.logoUrl ? <img src={pm.logoUrl} alt="" className="w-6 h-6 object-contain" /> : pm.kind.toUpperCase().slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text-primary truncate">{pm.name}</span>
                      <span className="block text-[11px] text-text-muted">{pm.kind.toUpperCase()}{pm.businessUnit ? ` · ${pm.businessUnit}` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <select
              aria-label={t('pos.payment.method', 'Payment method')}
              className="input-field"
              value={payMethod}
              onChange={(e) => onSelectMethod(null, e.target.value as PosPaymentMethod)}
              disabled={polling}
            >
              <option value="cash">{t('pos.payment.cash', 'Cash')}</option>
              <option value="qris_dynamic">{t('pos.payment.qrisScan', 'QRIS (scan to pay)')}</option>
              <option value="qris_static">{t('pos.payment.qrisStatic', 'QRIS (static — sudah ditempel)')}</option>
              <option value="edc">{t('pos.payment.edcDebit', 'EDC / Debit')}</option>
              <option value="cc">{t('pos.payment.creditCard', 'Credit Card')}</option>
              <option value="transfer">{t('pos.payment.bankTransfer', 'Bank Transfer')}</option>
            </select>
          )}
          {showQrisToggle && (
            <div className="mt-2 inline-flex rounded-md border border-border bg-surface-raised p-0.5" role="group" aria-label={t('pos.payment.qrisMode', 'QRIS mode')}>
              <button
                type="button"
                disabled={polling}
                onClick={() => onSelectMethod(selectedPmId, 'qris_dynamic')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${payMethod === 'qris_dynamic' ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {t('pos.payment.qrisDynamicShort', 'Dynamic (scan)')}
              </button>
              <button
                type="button"
                disabled={polling}
                onClick={() => onSelectMethod(selectedPmId, 'qris_static')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${payMethod === 'qris_static' ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {t('pos.payment.qrisStaticShort', 'Static (sudah bayar)')}
              </button>
            </div>
          )}
          {payMethod !== 'cash' && settlesTo && (
            <p className="mt-1.5 text-xs text-text-muted">
              {t('pos.payment.settlesTo', 'Settles to the')} <span className="font-medium text-text-primary">{settlesTo}</span> {t('pos.payment.account', 'account.')}
            </p>
          )}
        </div>

        {payMethod === 'cash' && !qr && (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1.5">{t('pos.payment.amountReceived', 'Amount Received')}</label>
            <input
              aria-label={t('pos.payment.amountReceived', 'Amount received')}
              type="number"
              className="input-field"
              value={amountReceived}
              onChange={(e) => onAmountReceivedChange(e.target.value)}
            />
            {cashInsufficient ? (
              <p role="alert" data-testid="cash-shortfall-error" className="mt-1 text-sm font-medium text-red-600">
                {t('pos.payment.shortfall', 'Shortfall:')} {fmt(shortfall)} — {t('pos.payment.shortfallHint', 'amount received is less than the total. Enter the full amount to continue.')}
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">
                {t('pos.payment.change', 'Change:')} <span className="font-medium text-text-primary">{fmt(change)}</span>
              </p>
            )}
          </div>
        )}

        {(payMethod === 'edc' || payMethod === 'cc' || payMethod === 'transfer') && (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1.5">
              {payMethod === 'transfer' ? t('pos.payment.transferReference', 'Transfer reference (last 4 digits)') : t('pos.payment.edcReference', 'Reference / trace number')}
            </label>
            <input
              aria-label={t('pos.payment.referenceNumber', 'Reference number')}
              className="input-field"
              placeholder={t('pos.payment.referencePlaceholder', 'e.g. 123456')}
              value={referenceNumber}
              onChange={(e) => onReferenceNumberChange(e.target.value)}
            />
            {referenceMissing && (
              <p role="alert" data-testid="reference-required-error" className="mt-1 text-sm font-medium text-red-600">
                {t('pos.payment.referenceRequired', 'Enter the reference/trace number to settle this payment.')}
              </p>
            )}
          </div>
        )}

        {payMethod === 'qris_static' && (
          <div className="mt-4 text-center">
            <p className="text-sm text-text-secondary mb-2">{t('pos.payment.qrisStaticInstruction', 'Ask the customer to scan the outlet\'s printed QRIS sticker, then confirm below once they\'ve paid.')}</p>
          </div>
        )}

        {qr && (
          <div className="mt-4 text-center">
            <p className="text-sm text-text-secondary mb-2">{t('pos.payment.scanQris', 'Scan with any QRIS app to pay')}</p>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
              alt={t('pos.payment.qrisAlt', 'QRIS payment code')}
              className="mx-auto rounded-lg border border-border"
              width={220}
              height={220}
            />
            <p className="mt-3 text-sm text-text-secondary flex items-center justify-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              {t('pos.payment.waitingConfirmation', 'Waiting for payment confirmation…')}
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button className="btn-secondary" onClick={onCancel} disabled={paying && !qr}>
            {qr ? t('pos.payment.close', 'Close') : t('pos.payment.cancel', 'Cancel')}
          </button>
          {!qr && (
            <button className="btn-primary" onClick={onConfirm} disabled={confirmDisabled} data-testid="payment-confirm-btn">
              {paying ? t('pos.payment.processing', 'Processing…')
                : payMethod === 'qris_dynamic' ? t('pos.payment.generateQr', 'Generate QR')
                  : payMethod === 'qris_static' ? t('pos.payment.markPaid', 'Tandai Sudah Bayar')
                    : t('pos.payment.confirmPayment', 'Confirm Payment')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
