'use client';

import type { PlateDetection } from '@aire/shared';
import { useI18n } from '@/lib/i18n';
import { minutesAgoLabel } from '@/lib/lprSuggestions';

/**
 * Tappable LPR suggestion chips for the new-order cart (AIRIN-25, POS half).
 *
 * Deliberately renders nothing — not even a wrapper element — when there are
 * no offerable detections: most branches have no ANPR camera at all, and this
 * must be completely invisible for them (no empty state, no reserved space).
 *
 * Tapping a chip is the ONLY thing that writes anything; `detections` arriving
 * or changing never does. The cashier confirms, the system never silently fills.
 */
export function LprSuggestions({
  detections,
  onPick,
  busyId,
}: {
  detections: PlateDetection[];
  onPick: (detection: PlateDetection) => void;
  /** Id of the detection currently being applied (member lookup in flight) — disables that one chip. */
  busyId?: string | null;
}) {
  const { t } = useI18n();
  if (detections.length === 0) return null;
  return (
    <div className="rounded-lg bg-violet-50 border border-violet-200 p-2" data-testid="lpr-suggestions">
      <label className="block text-[11px] font-medium text-violet-800 mb-1">
        {t('pos.new.lprDetectedHint', 'Plate detected by camera — tap to confirm:')}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {detections.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onPick(d)}
            disabled={busyId === d.id}
            data-testid={`lpr-chip-${d.id}`}
            className="badge border bg-white text-text-primary border-violet-300 hover:border-violet-400 disabled:opacity-50 disabled:cursor-wait"
          >
            {d.plateNormalized}
            <span className="text-text-muted"> · {minutesAgoLabel(d.capturedAt, t)}</span>
            {d.match && (
              <span className="text-violet-700"> · {d.match.customerName}{d.match.planName ? ` · ${d.match.planName}` : ''}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
