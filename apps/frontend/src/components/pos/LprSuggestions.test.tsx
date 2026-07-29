/**
 * Tests for the LPR suggestion chips (AIRIN-25, POS half).
 *
 * The one guarantee that matters most: a detection is a *suggestion*, never
 * an auto-write. The Harness below wires the real chip component the same
 * way new-order/page.tsx does — arrival only ever appends to the detection
 * list (via the real upsertDetection/filterOfferableDetections helpers);
 * filling the plate happens exclusively inside `onPick`, fired only by a tap.
 * That split is what these tests exercise end to end, not just at the
 * unit level.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LprSuggestions } from './LprSuggestions';
import { filterOfferableDetections, upsertDetection } from '@/lib/lprSuggestions';
import { LPR_MIN_CONFIDENCE, LPR_SUGGESTION_TTL_SECONDS, type PlateDetection, type PlateDetectionMatch } from '@aire/shared';

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

function makeDetection(overrides: Partial<PlateDetection> = {}): PlateDetection {
  return {
    id: 'd1',
    outletId: 'outlet-1',
    cameraId: 'cam-1',
    plate: 'D 9999 ZZ',
    plateNormalized: 'D9999ZZ',
    confidence: 0.9,
    capturedAt: new Date().toISOString(),
    cropImageUrl: null,
    source: 'test-device',
    match: null,
    confirmedPlate: null,
    orderId: null,
    ...overrides,
  };
}

const budiMatch: PlateDetectionMatch = {
  customerId: 'cust-1',
  customerName: 'Budi',
  customerPhone: '0812000000',
  membershipId: 'mem-1',
  membershipStatus: 'active',
  planName: 'Unlimited Wash',
  vehicleBrand: null,
  vehicleModel: null,
};

/** Mimics the relevant slice of new-order/page.tsx's LPR wiring: a plate
 *  field the cashier can type into, plus the suggestion list. `simulate` is
 *  the socket/poll arrival path; the chip's own onPick is the tap path. */
function Harness({ initialPlate = '', incoming }: { initialPlate?: string; incoming?: PlateDetection }) {
  const [plate, setPlate] = useState(initialPlate);
  const [detections, setDetections] = useState<PlateDetection[]>([]);
  const offerable = filterOfferableDetections(detections);
  return (
    <div>
      <input aria-label="plate" value={plate} readOnly />
      <LprSuggestions detections={offerable} onPick={(d) => setPlate(d.plateNormalized)} />
      {incoming && (
        <button onClick={() => setDetections((prev) => upsertDetection(prev, incoming))}>simulate-arrival</button>
      )}
    </div>
  );
}

describe('LprSuggestions', () => {
  it('renders no DOM node at all when there are nothing to offer (no layout shift)', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-testid="lpr-suggestions"]')).toBeNull();
  });

  it('a detection arriving NEVER overwrites a plate the cashier already typed', () => {
    const detection = makeDetection();
    render(<Harness initialPlate="B1234ABC" incoming={detection} />);

    fireEvent.click(screen.getByText('simulate-arrival'));

    // The chip is offered...
    expect(screen.getByTestId(`lpr-chip-${detection.id}`)).toBeInTheDocument();
    // ...but the plate the cashier typed is untouched.
    expect(screen.getByLabelText('plate')).toHaveValue('B1234ABC');
  });

  it('tapping the chip is the only thing that fills the plate field', () => {
    const detection = makeDetection();
    render(<Harness incoming={detection} />);
    fireEvent.click(screen.getByText('simulate-arrival'));

    expect(screen.getByLabelText('plate')).toHaveValue('');
    fireEvent.click(screen.getByTestId(`lpr-chip-${detection.id}`));
    expect(screen.getByLabelText('plate')).toHaveValue('D9999ZZ');
  });

  it('does not offer a stale detection (outside the TTL) even after it "arrives"', () => {
    const stale = makeDetection({ capturedAt: new Date(Date.now() - (LPR_SUGGESTION_TTL_SECONDS + 60) * 1000).toISOString() });
    render(<Harness incoming={stale} />);
    fireEvent.click(screen.getByText('simulate-arrival'));
    expect(screen.queryByTestId(`lpr-chip-${stale.id}`)).toBeNull();
  });

  it('does not offer a low-confidence detection even after it "arrives"', () => {
    const unreliable = makeDetection({ confidence: LPR_MIN_CONFIDENCE - 0.01 });
    render(<Harness incoming={unreliable} />);
    fireEvent.click(screen.getByText('simulate-arrival'));
    expect(screen.queryByTestId(`lpr-chip-${unreliable.id}`)).toBeNull();
  });

  it('shows the matched member name and plan on the chip — the payoff moment', () => {
    const detection = makeDetection({ match: budiMatch });
    render(<Harness incoming={detection} />);
    fireEvent.click(screen.getByText('simulate-arrival'));

    const chip = screen.getByTestId(`lpr-chip-${detection.id}`);
    expect(chip.textContent).toContain('D9999ZZ');
    expect(chip.textContent).toContain('Budi');
    expect(chip.textContent).toContain('Unlimited Wash');
  });

  it('disables the chip for the busy id (member lookup in flight)', () => {
    const detection = makeDetection();
    render(<LprSuggestions detections={[detection]} onPick={() => {}} busyId={detection.id} />);
    expect(screen.getByTestId(`lpr-chip-${detection.id}`)).toBeDisabled();
  });
});
