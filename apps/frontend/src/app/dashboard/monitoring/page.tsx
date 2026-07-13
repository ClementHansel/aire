'use client';

/**
 * AI Monitoring panel — real-time view of agent load.
 * Polls invocation summary, recent invocations, and domain-event throughput.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface KindStat {
  kind: string;
  total: number;
  errors: number;
  avgMs: number;
  promptTokens: number;
  completionTokens: number;
}

interface Summary {
  windowHours: number;
  totalInvocations: number;
  totalErrors: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byKind: KindStat[];
  topTools: { name: string; count: number }[];
}

interface Invocation {
  id: string;
  kind: string;
  name: string;
  status: string;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  error: string | null;
  createdAt: string;
}

interface EventsResp {
  events: { id: string; type: string; payload: Record<string, unknown>; createdAt: string }[];
  throughput: { type: string; count: number }[];
}

const fmtTime = (s: string) => new Date(s).toLocaleTimeString();

export default function MonitoringPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Invocation[]>([]);
  const [events, setEvents] = useState<EventsResp | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, r, e] = await Promise.all([
        api.get<Summary>('/agent/monitoring/summary'),
        api.get<Invocation[]>('/agent/monitoring/recent?limit=40'),
        api.get<EventsResp>('/agent/monitoring/events?limit=40'),
      ]);
      setSummary(s);
      setRecent(r);
      setEvents(e);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.monitoring.failedToLoad', 'Failed to load monitoring data'));
    }
  }, [t]);

  useEffect(() => {
    load();
    if (!live) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, live]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{t('dash.monitoring.title', 'AI Monitoring')}</h1>
          <p className="text-sm text-text-muted">{t('dash.monitoring.subtitle', 'Real-time agent usage and load across LLM calls, tools, chat, and events.')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          {t('dash.monitoring.live', 'Live (5s)')}
        </label>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted">{t('dash.monitoring.invocations', 'Invocations')} ({summary?.windowHours ?? 24}h)</p>
          <p className="text-2xl font-semibold text-text-primary">{summary?.totalInvocations ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">{t('dash.monitoring.errors', 'Errors')}</p>
          <p className="text-2xl font-semibold text-red-600">{summary?.totalErrors ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">{t('dash.monitoring.llmTokens', 'LLM Tokens')}</p>
          <p className="text-2xl font-semibold text-text-primary">{(summary?.totalTokens ?? 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">{t('dash.monitoring.estCost', 'Est. cost')}</p>
          <p className="text-2xl font-semibold text-text-primary">${(summary?.estimatedCostUsd ?? 0).toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">{t('dash.monitoring.eventsPerHr', 'Events / hr')}</p>
          <p className="text-2xl font-semibold text-text-primary">{events?.throughput.reduce((s, ev) => s + ev.count, 0) ?? 0}</p>
        </div>
      </div>

      {/* By kind + top tools */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.monitoring.byType', 'By type')}</h2>
          <div className="space-y-2">
            {(summary?.byKind ?? []).map((k) => (
              <div key={k.kind} className="flex items-center justify-between text-sm">
                <span className="capitalize font-medium text-text-primary">{k.kind}</span>
                <span className="text-text-secondary">{k.total} {t('dash.monitoring.calls', 'calls')} · {k.errors} {t('dash.monitoring.err', 'err')} · {k.avgMs}ms {t('dash.monitoring.avg', 'avg')}</span>
              </div>
            ))}
            {(summary?.byKind ?? []).length === 0 && <p className="text-sm text-text-muted">{t('dash.monitoring.noActivity', 'No activity yet.')}</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.monitoring.topTools', 'Top tools')}</h2>
          <div className="space-y-2">
            {(summary?.topTools ?? []).map((tool) => (
              <div key={tool.name} className="flex items-center justify-between text-sm">
                <span className="font-mono text-text-primary">{tool.name}</span>
                <span className="text-text-secondary">{tool.count}</span>
              </div>
            ))}
            {(summary?.topTools ?? []).length === 0 && <p className="text-sm text-text-muted">{t('dash.monitoring.noToolCalls', 'No tool calls yet.')}</p>}
          </div>
        </div>
      </div>

      {/* Recent invocations + events */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.monitoring.recentInvocations', 'Recent invocations')}</h2>
          <div className="space-y-1.5 max-h-96 overflow-auto">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-text-muted w-16 shrink-0">{fmtTime(r.createdAt)}</span>
                <span className="badge bg-surface-sunken text-text-secondary">{r.kind}</span>
                <span className="font-mono text-text-primary truncate flex-1">{r.name}</span>
                {r.durationMs != null && <span className="text-text-muted">{r.durationMs}ms</span>}
              </div>
            ))}
            {recent.length === 0 && <p className="text-sm text-text-muted">{t('dash.monitoring.noInvocations', 'No invocations recorded yet.')}</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.monitoring.recentEvents', 'Recent events')}</h2>
          <div className="space-y-1.5 max-h-96 overflow-auto">
            {(events?.events ?? []).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="text-text-muted w-16 shrink-0">{fmtTime(e.createdAt)}</span>
                <span className="font-mono text-primary-700">{e.type}</span>
              </div>
            ))}
            {(events?.events ?? []).length === 0 && <p className="text-sm text-text-muted">{t('dash.monitoring.noEvents', 'No events yet. They appear as orders, payments, and memberships happen.')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
