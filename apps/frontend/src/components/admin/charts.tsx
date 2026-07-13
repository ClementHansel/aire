'use client';

/**
 * Lightweight presentational charts for the platform-admin dashboard.
 *
 * These are deliberately dependency-free (no charting lib): the admin only
 * needs at-a-glance trend bars, not interactive analytics. Bars are theme-aware
 * (heights are inline, everything else is token-driven) and share one hover
 * tooltip pattern so every admin page reads the same.
 */

import { type ReactNode } from 'react';

export interface BarDatum { label: string; value: number; tooltip?: string }

/**
 * Vertical bar chart. `color` is any CSS color (defaults to the brand primary).
 * Renders an empty-state string when there is no data.
 */
export function BarChart({
  data,
  color = 'var(--color-primary-500, #1652F0)',
  height = 128,
  empty = 'No data.',
}: {
  data: BarDatum[];
  color?: string;
  height?: number;
  empty?: ReactNode;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  if (data.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 flex flex-col justify-end min-w-[2px]"
          title={d.tooltip ?? `${d.label}: ${d.value}`}
        >
          <div
            className="w-full rounded-t transition-[height]"
            style={{ height: `${(Number(d.value) / max) * 100}%`, background: color, minHeight: d.value > 0 ? 2 : 0 }}
          />
        </div>
      ))}
    </div>
  );
}
