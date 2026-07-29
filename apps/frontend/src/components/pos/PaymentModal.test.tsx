/**
 * Unit tests for the shared POS payment modal (AIRIN-125) — used by both
 * new-order and sell-pack. Focus areas: cash shortfall must block confirmation
 * (AIRIN-127), the QRIS static/dynamic toggle, the reference-number gate for
 * EDC/CC/transfer, and the payMethods-empty fallback select.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentModal, type PaymentMethodDTO, type PosPaymentMethod, type PaymentSummaryLine } from './PaymentModal';

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

const summaryLines: PaymentSummaryLine[] = [
  { key: 'subtotal', label: 'Subtotal', amount: 100_000 },
  { key: 'total', label: 'Total', amount: 100_000, emphasis: true },
];

const cashPm: PaymentMethodDTO = { id: 'pm-cash', name: 'Tunai', kind: 'cash', businessUnit: 'AIRE', logoUrl: null, color: '#333' };
const qrisPm: PaymentMethodDTO = { id: 'pm-qris', name: 'QRIS', kind: 'qris', businessUnit: 'AIRE', logoUrl: null, color: '#0a0' };
const edcPm: PaymentMethodDTO = { id: 'pm-edc', name: 'EDC BCA', kind: 'edc', businessUnit: 'LEAD', logoUrl: null, color: '#00a' };

/** Stateful harness — PaymentModal is fully controlled, so the test owns the
 *  state a real page would own and wires it straight through. */
function Harness({
  total = 100_000,
  payMethods = [],
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
  initialAmountReceived = String(total),
  membershipQuotaWarning,
  businessUnit,
}: {
  total?: number;
  payMethods?: PaymentMethodDTO[];
  onConfirm?: () => void;
  onCancel?: () => void;
  initialAmountReceived?: string;
  membershipQuotaWarning?: string;
  businessUnit?: string;
}) {
  const [payMethod, setPayMethod] = useState<PosPaymentMethod>('cash');
  const [selectedPmId, setSelectedPmId] = useState<string | null>(null);
  const [amountReceived, setAmountReceived] = useState(initialAmountReceived);
  const [referenceNumber, setReferenceNumber] = useState('');

  return (
    <PaymentModal
      orderLabel="Payment — ORD-1"
      total={total}
      summaryLines={summaryLines}
      membershipQuotaWarning={membershipQuotaWarning}
      payMethods={payMethods}
      selectedPmId={selectedPmId}
      payMethod={payMethod}
      onSelectMethod={(pmId, method) => { setSelectedPmId(pmId); setPayMethod(method); }}
      businessUnit={businessUnit}
      amountReceived={amountReceived}
      onAmountReceivedChange={setAmountReceived}
      referenceNumber={referenceNumber}
      onReferenceNumberChange={setReferenceNumber}
      qr={null}
      polling={false}
      paying={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

describe('PaymentModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the order label and summary lines', () => {
    render(<Harness />);
    expect(screen.getByText('Payment — ORD-1')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
  });

  describe('AIRIN-127: cash shortfall', () => {
    it('confirms a cash payment when the amount received covers the total', () => {
      const onConfirm = vi.fn();
      render(<Harness onConfirm={onConfirm} />);

      const confirmBtn = screen.getByTestId('payment-confirm-btn') as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(false);
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows an explicit shortfall error and disables Confirm when amount received < total', () => {
      const onConfirm = vi.fn();
      render(<Harness total={100_000} initialAmountReceived="100000" onConfirm={onConfirm} />);

      const input = screen.getByLabelText('Amount received') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '50000' } });

      const error = screen.getByTestId('cash-shortfall-error');
      expect(error).toBeInTheDocument();
      // fmt() uses the id-ID locale — thousands are dot-separated ("50.000"),
      // not comma-separated.
      expect(error.textContent).toContain('50.000');

      const confirmBtn = screen.getByTestId('payment-confirm-btn') as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(true);
      fireEvent.click(confirmBtn);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('clears the shortfall error once enough cash is entered', () => {
      render(<Harness total={100_000} />);
      const input = screen.getByLabelText('Amount received') as HTMLInputElement;

      fireEvent.change(input, { target: { value: '50000' } });
      expect(screen.getByTestId('cash-shortfall-error')).toBeInTheDocument();

      fireEvent.change(input, { target: { value: '150000' } });
      expect(screen.queryByTestId('cash-shortfall-error')).toBeNull();
      expect(screen.getByText(/Change:/)).toBeInTheDocument();
    });

    it('treats an empty amount as a full shortfall (blocks confirm)', () => {
      render(<Harness total={100_000} />);
      const input = screen.getByLabelText('Amount received') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '' } });

      expect(screen.getByTestId('cash-shortfall-error')).toBeInTheDocument();
      expect((screen.getByTestId('payment-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('Reference-number gate (EDC / CC / transfer)', () => {
    it('disables Confirm and shows an error until a reference number is entered', () => {
      render(<Harness payMethods={[cashPm, edcPm]} />);

      fireEvent.click(screen.getByText('EDC BCA'));
      expect(screen.getByTestId('reference-required-error')).toBeInTheDocument();
      expect((screen.getByTestId('payment-confirm-btn') as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(screen.getByLabelText('Reference number'), { target: { value: '123456' } });
      expect(screen.queryByTestId('reference-required-error')).toBeNull();
      expect((screen.getByTestId('payment-confirm-btn') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('Payment-method rendering', () => {
    it('renders the button grid from payMethods when present', () => {
      render(<Harness payMethods={[cashPm, qrisPm]} />);
      expect(screen.getByText('Tunai')).toBeInTheDocument();
      expect(screen.getByText('QRIS')).toBeInTheDocument();
    });

    it('falls back to a static select with all six methods when payMethods is empty', () => {
      render(<Harness payMethods={[]} />);
      const select = screen.getByLabelText('Payment method') as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(['cash', 'qris_dynamic', 'qris_static', 'edc', 'cc', 'transfer']);
    });

    it('shows the dynamic/static QRIS toggle only after a QRIS pm tile is picked', () => {
      render(<Harness payMethods={[cashPm, qrisPm]} />);
      expect(screen.queryByRole('group', { name: 'QRIS mode' })).toBeNull();

      fireEvent.click(screen.getByText('QRIS'));
      expect(screen.getByRole('group', { name: 'QRIS mode' })).toBeInTheDocument();

      fireEvent.click(screen.getByText('Static (sudah bayar)'));
      expect(screen.getByText(/printed QRIS sticker/)).toBeInTheDocument();
    });

    it('hides the settles-to note when no business unit can be resolved', () => {
      render(<Harness payMethods={[]} />);
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'transfer' } });
      expect(screen.queryByText(/Settles to the/)).toBeNull();
    });

    it('shows the settles-to note once a business unit is resolved', () => {
      render(<Harness payMethods={[cashPm, edcPm]} />);
      fireEvent.click(screen.getByText('EDC BCA'));
      expect(screen.getByText(/Settles to the/)).toBeInTheDocument();
      expect(screen.getByText('LEAD')).toBeInTheDocument();
    });
  });

  describe('Membership quota warning', () => {
    it('shows the advisory when provided', () => {
      render(<Harness membershipQuotaWarning="Kuota membership sudah habis." />);
      expect(screen.getByText(/Kuota membership sudah habis/)).toBeInTheDocument();
    });

    it('omits it when not provided', () => {
      render(<Harness />);
      expect(screen.queryByText(/Kuota membership/)).toBeNull();
    });
  });

  describe('Cancel', () => {
    it('calls onCancel when clicked', () => {
      const onCancel = vi.fn();
      render(<Harness onCancel={onCancel} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
