/**
 * PosNav — shared POS top navigation/header bar.
 *
 * Renders the brand mark, the consistent set of POS tab links (Hub, New Order,
 * Orders, Sell Pack, Queue, Summary, Shift), and the signed-in user + sign-out
 * control. Centralising this keeps every POS page's navigation identical so no
 * sub-route becomes orphaned.
 */
'use client';

import Link from 'next/link';
import { getUser, logout } from '@/lib/auth';

export type PosTab = 'new-order' | 'orders' | 'sell-pack' | 'queue' | 'summary' | 'shift';

const TABS: { id: PosTab; label: string }[] = [
  { id: 'new-order', label: 'New Order' },
  { id: 'orders', label: 'Orders' },
  { id: 'sell-pack', label: 'Sell Pack' },
  { id: 'queue', label: 'Queue' },
  { id: 'summary', label: 'Summary' },
  { id: 'shift', label: 'Shift' },
];

export interface PosNavProps {
  /** The outlet/agent route param the POS pages are scoped to. */
  agent: string;
  /** Which tab is currently active (rendered as a non-link highlight). */
  active: PosTab;
  /** Optional header title; defaults to the active tab's label. */
  title?: string;
  /** Optional sub-label under the title (e.g. the agent id). */
  subtitle?: string;
}

export function PosNav({ agent, active, title, subtitle }: PosNavProps) {
  const user = getUser();
  const activeLabel = TABS.find((t) => t.id === active)?.label ?? 'POS';

  return (
    <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
            <span className="text-sm font-bold text-white">A</span>
          </div>
          <div>
            <p className="font-semibold text-text-primary text-sm">{title ?? activeLabel}</p>
            {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        <nav className="hidden sm:flex gap-1 text-sm" data-testid="pos-nav">
          <Link href="/hub" className="btn-ghost py-1.5 px-3">🏠 Hub</Link>
          {TABS.map((t) =>
            t.id === active ? (
              <span key={t.id} className="btn-ghost py-1.5 px-3 bg-surface-sunken" data-testid={`pos-nav-${t.id}-active`}>
                {t.label}
              </span>
            ) : (
              <Link key={t.id} href={`/pos/${agent}/${t.id}`} className="btn-ghost py-1.5 px-3" data-testid={`pos-nav-${t.id}`}>
                {t.label}
              </Link>
            ),
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-secondary">{user?.name}</span>
        <button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary">
          Sign out
        </button>
      </div>
    </header>
  );
}
