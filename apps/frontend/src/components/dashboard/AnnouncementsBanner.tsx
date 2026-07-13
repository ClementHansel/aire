'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Announcement {
  id: string; title: string; body: string;
  severity: 'info' | 'warning' | 'critical';
}

const STYLES: Record<Announcement['severity'], string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
};
const ICON: Record<Announcement['severity'], string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

const DISMISS_KEY = 'aire-dismissed-announcements';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
}

/**
 * Surfaces platform announcements published to this tenant (all / plan / tenant
 * targeted) at the top of the dashboard. Dismissals are remembered per-id in
 * localStorage so a message doesn't nag after it's been read. Fails silently —
 * an announcements outage must never block the dashboard.
 */
export default function AnnouncementsBanner() {
  const { t } = useI18n();
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(loadDismissed());
    api.get<Announcement[]>('/announcements/feed').then(setItems).catch(() => setItems([]));
  }, []);

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const visible = items.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-6 space-y-2" data-testid="announcements-banner">
      {visible.map((a) => (
        <div key={a.id} className={cn('flex items-start justify-between gap-3 rounded-lg border px-4 py-3', STYLES[a.severity])}>
          <div className="flex items-start gap-2.5 min-w-0">
            <span aria-hidden>{ICON[a.severity]}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="text-sm opacity-90 whitespace-pre-wrap">{a.body}</p>
            </div>
          </div>
          <button
            onClick={() => dismiss(a.id)}
            className="shrink-0 text-current/70 hover:text-current text-sm"
            aria-label={t('common.dismiss', 'Dismiss')}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
