/**
 * PosNav — shared POS top navigation/header bar.
 *
 * Renders the brand mark, the consistent set of POS tab links (New Order,
 * Orders, Queue, Summary, Shift), and the signed-in user + sign-out control.
 * Centralising this keeps every POS page's navigation identical so no sub-route
 * becomes orphaned.
 *
 * There is deliberately no "Sell Pack" tab: membership plans and voucher packs
 * are sold from the New Order screen, on the same order as the wash (Samuel
 * 2026-07-30 — "supaya jadinya ga ada halaman jual paket, semua di satu halaman").
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser, clearSession } from '@/lib/auth';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { AirinLogo } from '@/components/shared/AirinLogo';

export type PosTab = 'new-order' | 'orders' | 'queue' | 'summary' | 'shift';

const TABS: { id: PosTab; label: string; key: string }[] = [
  { id: 'new-order', label: 'New Order', key: 'pos.newOrder' },
  { id: 'orders', label: 'Orders', key: 'pos.orders' },
  { id: 'queue', label: 'Queue', key: 'pos.queue' },
  { id: 'summary', label: 'Summary', key: 'pos.summary' },
  { id: 'shift', label: 'Shift', key: 'pos.shift' },
];

export interface PosNavProps {
  /** The outlet/agent route param the POS pages are scoped to. */
  agent: string;
  /** Which tab is currently active (rendered as a non-link highlight). */
  active: PosTab;
  /** Optional header title; defaults to the active tab's label. */
  title?: string;
  /**
   * Optional sub-label under the title. When omitted, PosNav resolves the
   * branch name for `agent` and shows "Agent: <branch name>" instead of the
   * raw outlet id.
   */
  subtitle?: string;
}

export function PosNav({ agent, active, title, subtitle }: PosNavProps) {
  const user = getUser();
  const { t } = useI18n();
  // Resolve the branch name for the outlet id in the URL so the header shows a
  // human-readable name ("Agent: Super Made Branch") rather than the raw UUID.
  const [agentName, setAgentName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ id: string; name: string }[]>('/outlets')
      .then((outlets) => {
        if (cancelled) return;
        const match = outlets.find((o) => o.id === agent);
        if (match) setAgentName(match.name);
      })
      .catch(() => { /* fall back to the passed subtitle / raw id */ });
    return () => { cancelled = true; };
  }, [agent]);

  const activeTab = TABS.find((tab) => tab.id === active);
  const activeLabel = activeTab ? t(activeTab.key, activeTab.label) : 'POS';
  // Prefer an explicit subtitle from the page; otherwise show the resolved
  // branch name once it loads.
  const resolvedSubtitle = subtitle ?? (agentName ? `${t('pos.agent', 'Branch')}: ${agentName}` : undefined);

  return (
    <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          {/* Official Airin mark (brand kit, 2026-07-30) — replaces the
              hand-drawn "A" box. AirinLogo picks the per-theme variant; the
              gradient asset alone lost its left half on the dark theme. */}
          <AirinLogo size="sm" showWordmark={false} />
          <div>
            <p className="font-semibold text-text-primary text-sm">{title ?? activeLabel}</p>
            {resolvedSubtitle && <p className="text-xs text-text-muted">{resolvedSubtitle}</p>}
          </div>
        </div>
        {/* No "Hub" escape here — a registered POS terminal stays in the POS
            shell; leaving happens by signing out (which shows the cashier gate). */}
        <nav className="hidden sm:flex gap-1 text-sm" data-testid="pos-nav">
          {TABS.map((tab) =>
            tab.id === active ? (
              <span key={tab.id} className="btn-ghost py-1.5 px-3 bg-surface-sunken" data-testid={`pos-nav-${tab.id}-active`}>
                {t(tab.key, tab.label)}
              </span>
            ) : (
              <Link key={tab.id} href={`/pos/${agent}/${tab.id}`} className="btn-ghost py-1.5 px-3" data-testid={`pos-nav-${tab.id}`}>
                {t(tab.key, tab.label)}
              </Link>
            ),
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <LanguageToggle />
        <ThemeToggle className="h-8 w-8" />
        <span className="text-xs text-text-secondary">{user?.name}</span>
        {/* Sign out the cashier but keep the terminal registered (the device pin
            lives outside the session). Signing out returns to the LOGIN page:
            reloading in place left the operator staring at the POS shell's own
            gate, which reads as "nothing happened" (AIRIN-173). */}
        <button
          onClick={() => { clearSession(); if (typeof window !== 'undefined') window.location.href = '/'; }}
          className="text-xs text-text-secondary hover:text-text-primary"
        >
          {t('common.signOut', 'Sign out')}
        </button>
      </div>
    </header>
  );
}
