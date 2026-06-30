'use client';

/**
 * AI Monitoring panel — real-time view of agent load.
 * Polls invocation summary, recent invocations, and domain-event throughput.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

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
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data');
    }
  }, []);

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
          <h1 className="text-xl font-semibold text-text-primary">AI Monitoring</h1>
          <p className="text-sm text-text-muted">Real-time agent usage and load across LLM calls, tools, chat, and events.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live (5s)
        </label>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted">Invocations ({summary?.windowHours ?? 24}h)</p>
          <p className="text-2xl font-semibold text-text-primary">{summary?.totalInvocations ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">Errors</p>
          <p className="text-2xl font-semibold text-red-600">{summary?.totalErrors ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">LLM Tokens</p>
          <p className="text-2xl font-semibold text-text-primary">{(summary?.totalTokens ?? 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted">Events / hr</p>
          <p className="text-2xl font-semibold text-text-primary">{events?.throughput.reduce((s, t) => s + t.count, 0) ?? 0}</p>
        </div>
      </div>

      {/* By kind + top tools */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">By type</h2>
          <div className="space-y-2">
            {(summary?.byKind ?? []).map((k) => (
              <div key={k.kind} className="flex items-center justify-between text-sm">
                <span className="capitalize font-medium text-text-primary">{k.kind}</span>
                <span className="text-text-secondary">{k.total} calls · {k.errors} err · {k.avgMs}ms avg</span>
              </div>
            ))}
            {(summary?.byKind ?? []).length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">Top tools</h2>
          <div className="space-y-2">
            {(summary?.topTools ?? []).map((t) => (
              <div key={t.name} className="flex items-center justify-between text-sm">
                <span className="font-mono text-text-primary">{t.name}</span>
                <span className="text-text-secondary">{t.count}</span>
              </div>
            ))}
            {(summary?.topTools ?? []).length === 0 && <p className="text-sm text-text-muted">No tool calls yet.</p>}
          </div>
        </div>
      </div>

      {/* Recent invocations + events */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Recent invocations</h2>
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
            {recent.length === 0 && <p className="text-sm text-text-muted">No invocations recorded yet.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">Recent events</h2>
          <div className="space-y-1.5 max-h-96 overflow-auto">
            {(events?.events ?? []).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="text-text-muted w-16 shrink-0">{fmtTime(e.createdAt)}</span>
                <span className="font-mono text-primary-700">{e.type}</span>
              </div>
            ))}
            {(events?.events ?? []).length === 0 && <p className="text-sm text-text-muted">No events yet. They appear as orders, payments, and memberships happen.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
