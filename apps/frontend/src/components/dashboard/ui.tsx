'use client';

/**
 * Shared dashboard UI kit.
 *
 * A small set of presentational primitives so the operational pages (Finance,
 * COGS, Settlement, HR, Payroll) read as one product rather than a pile of
 * one-off layouts. Everything here is built from the same design-system
 * utilities (`card`, `input-field`, `badge`, semantic color tokens) already
 * used across the dashboard, so it inherits tenant branding automatically.
 */

import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/* ── Formatters ─────────────────────────────────────────────────────── */

/** Indonesian Rupiah, rounded to whole rupiah. */
export const fmtIDR = (n: number | null | undefined) =>
  `Rp ${Math.round(Number(n ?? 0)).toLocaleString('id-ID')}`;

/** Signed Rupiah — shows a leading + for positive values (variances, deltas). */
export const fmtIDRSigned = (n: number | null | undefined) => {
  const v = Math.round(Number(n ?? 0));
  return `${v > 0 ? '+' : ''}${fmtIDR(v)}`;
};

/** Percentage with one decimal. */
export const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(1)}%`;

/** Short date (locale-aware) from an ISO date/datetime string. */
export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Date + time. */
export const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* ── Page header ────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-secondary max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  );
}

/* ── Error banner ───────────────────────────────────────────────────── */

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <span className="flex items-start gap-2"><span aria-hidden>⚠</span><span>{message}</span></span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-red-500 hover:text-red-700" aria-label="Dismiss">✕</button>
      )}
    </div>
  );
}

/* ── Stat / KPI card ────────────────────────────────────────────────── */

type Tone = 'default' | 'positive' | 'negative' | 'warning' | 'primary';

const toneText: Record<Tone, string> = {
  default: 'text-text-primary',
  positive: 'text-green-600',
  negative: 'text-rose-600',
  warning: 'text-amber-600',
  primary: 'text-primary-600',
};

export function StatCard({
  label,
  value,
  tone = 'default',
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-surface-sunken" />
      ) : (
        <p className={cn('mt-1 text-2xl font-bold tabular-nums', toneText[tone])}>{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/* ── Panel (card with header) ───────────────────────────────────────── */

export function Panel({
  title,
  description,
  actions,
  children,
  bodyClassName,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn('card p-0 overflow-hidden', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </div>
  );
}

/* ── Table primitives ───────────────────────────────────────────────── */

export const thCls = 'px-5 py-3 text-xs font-medium uppercase tracking-wide text-text-secondary';
export const tdCls = 'px-5 py-3 text-sm text-text-primary';

/** Table wrapper that scrolls horizontally on narrow screens. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full">{children}</table></div>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-text-muted">{children}</td>
    </tr>
  );
}

/* ── Loading / empty states ─────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-5">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="h-4 flex-1 animate-pulse rounded bg-surface-sunken" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Status badge ───────────────────────────────────────────────────── */

const statusTones: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  approved: 'bg-green-50 text-green-700',
  finalized: 'bg-green-50 text-green-700',
  paid: 'bg-green-50 text-green-700',
  present: 'bg-green-50 text-green-700',
  applied: 'bg-sky-50 text-sky-700',
  draft: 'bg-amber-50 text-amber-700',
  pending: 'bg-amber-50 text-amber-700',
  late: 'bg-amber-50 text-amber-700',
  rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-rose-50 text-rose-700',
  absent: 'bg-rose-50 text-rose-700',
  inactive: 'bg-surface-sunken text-text-secondary',
};

export function StatusBadge({ status }: { status: string }) {
  const key = (status || '').toLowerCase();
  return <span className={cn('badge capitalize', statusTones[key] ?? 'bg-surface-sunken text-text-secondary')}>{status || '—'}</span>;
}

/* ── Modal ──────────────────────────────────────────────────────────── */

export function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('card w-full max-h-[90vh] overflow-y-auto', maxWidth)} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="section-title">{title}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">✕</button>
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────── */

export function Tabs<T extends string>({
  tabs, active, onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-surface-sunken p-1">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          onClick={() => onChange(tb.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm',
            active === tb.id ? 'bg-surface-raised font-medium text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {tb.label}
          {tb.badge != null && tb.badge > 0 && (
            <span className="rounded-full bg-primary-500 px-1.5 text-2xs font-semibold text-white">{tb.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Searchable select ──────────────────────────────────────────────── */

export function SearchSelect<T extends { id: string; label: string }>({
  items, value, onChange, placeholder, ariaLabel,
}: {
  items: T[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : items;
  return (
    <div className="relative">
      <input
        className="input-field"
        aria-label={ariaLabel}
        value={open ? q : selected?.label ?? ''}
        placeholder={placeholder ?? 'Search…'}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-surface-raised shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">No matches</p>
          ) : filtered.map((i) => (
            <button
              key={i.id}
              type="button"
              className={cn('block w-full px-3 py-2 text-left text-sm hover:bg-surface-sunken', i.id === value && 'bg-surface-sunken font-medium')}
              onMouseDown={(e) => { e.preventDefault(); onChange(i.id); setOpen(false); }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Labeled field (form) ───────────────────────────────────────────── */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-text-primary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}
