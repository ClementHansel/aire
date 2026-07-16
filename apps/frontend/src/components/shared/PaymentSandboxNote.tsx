'use client';

/**
 * Reusable banner shown wherever an online/gateway payment (QRIS, card, transfer)
 * is taken. Real payment-provider onboarding is still pending, so charges run in
 * SANDBOX/MOCK mode and auto-confirm — this lets every downstream flow (accounting,
 * commission, membership, queue, receipts) be exercised end-to-end without a live
 * gateway. No real money moves. Cash is unaffected (always real).
 */
export function PaymentSandboxNote({ className = '' }: { className?: string }) {
  return (
    <div
      data-testid="payment-sandbox-note"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 ${className}`}
    >
      <span className="font-semibold">⚠ Sandbox / mock payments.</span>{' '}
      Live payment-provider onboarding is still pending, so QRIS &amp; card/transfer
      charges auto-confirm to demonstrate the full flow. No real money moves.
    </div>
  );
}
