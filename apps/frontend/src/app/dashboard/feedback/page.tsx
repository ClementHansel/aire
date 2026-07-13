'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, Tabs, TableWrap, thCls, tdCls, EmptyRow, Spinner,
  ErrorBanner, Field, fmtDateTime,
} from '@/components/dashboard/ui';
import { exportRows, type CsvColumn } from '@/components/dashboard/CsvTools';

interface Summary {
  responseCount: number;
  avgRating: number;
  npsScore: number;
  npsResponseCount: number;
  ratingDistribution: Record<string, number>;
  trend: { day: string; count: number; avgRating: number }[];
}

interface FeedbackResponse {
  id: string;
  rating: number;
  nps: number | null;
  comment: string | null;
  createdAt: string;
  outletName: string | null;
  orderNumber: string | null;
}

type FeedbackQuestionType = 'rating' | 'nps' | 'text';
interface FeedbackQuestion {
  id: string;
  type: FeedbackQuestionType;
  label: string;
  enabled: boolean;
}
interface FeedbackConfig {
  enabled: boolean;
  sendOnPaid: boolean;
  thanksMessage: string;
  expiryDays: number;
  sendDelayMinutes: number;
  alertThresholdRating: number | null;
  alertOnDetractor: boolean;
  questions: FeedbackQuestion[];
}

type Tab = 'overview' | 'setup';

const RESP_CSV_COLUMNS: CsvColumn[] = [
  { key: 'created_at', label: 'Date' },
  { key: 'outlet', label: 'Branch' },
  { key: 'order_number', label: 'Order' },
  { key: 'rating', label: 'Rating' },
  { key: 'nps', label: 'NPS' },
  { key: 'comment', label: 'Comment' },
];

function npsTone(score: number): 'positive' | 'warning' | 'negative' {
  if (score >= 50) return 'positive';
  if (score >= 0) return 'warning';
  return 'negative';
}

export default function FeedbackDashboardPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [responses, setResponses] = useState<FeedbackResponse[]>([]);
  const [config, setConfig] = useState<FeedbackConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', `${to}T23:59:59`);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    try {
      const [s, r, c] = await Promise.all([
        api.get<Summary>(`/feedback/summary${suffix}`),
        api.get<FeedbackResponse[]>(`/feedback/responses${suffix}`),
        api.get<FeedbackConfig>('/feedback/config'),
      ]);
      setSummary(s); setResponses(r); setConfig(c); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.feedback.loadError', 'Failed to load feedback'));
    } finally { setLoading(false); }
  }, [from, to, t]);
  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true); setSavedMsg('');
    try {
      const next = await api.put<FeedbackConfig>('/feedback/config', config);
      setConfig(next);
      setSavedMsg(t('dash.feedback.saved', 'Settings saved.'));
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.feedback.saveError', 'Failed to save'));
    } finally { setSaving(false); }
  };

  const exportCsv = () => {
    const rows = responses.map((r) => ({
      created_at: fmtDateTime(r.createdAt),
      outlet: r.outletName ?? '',
      order_number: r.orderNumber ?? '',
      rating: String(r.rating),
      nps: r.nps != null ? String(r.nps) : '',
      comment: r.comment ?? '',
    }));
    exportRows('feedback-responses.csv', rows, RESP_CSV_COLUMNS);
  };

  const maxRating = summary
    ? Math.max(1, ...Object.values(summary.ratingDistribution))
    : 1;
  const comments = responses.filter((r) => r.comment && r.comment.trim());

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t('dash.feedback.title', 'Customer feedback')}
        subtitle={t('dash.feedback.subtitle', 'Post-service ratings and NPS collected via WhatsApp. Turn it on in Setup to start sending links when an order is paid.')}
        actions={
          tab === 'overview' && responses.length > 0
            ? <button className="btn-secondary" onClick={exportCsv}>{t('dash.feedback.export', 'Export CSV')}</button>
            : undefined
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Tabs<Tab>
        tabs={[
          { id: 'overview', label: t('dash.feedback.tabOverview', 'Overview') },
          { id: 'setup', label: t('dash.feedback.tabSetup', 'Setup') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Date range */}
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('dash.feedback.from', 'From')}>
              <input type="date" className="input-field" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('dash.feedback.to', 'To')}>
              <input type="date" className="input-field" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            {(from || to) && (
              <button className="btn-ghost" onClick={() => { setFrom(''); setTo(''); }}>{t('dash.feedback.clear', 'Clear')}</button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label={t('dash.feedback.avgRating', 'Average rating')}
              value={summary ? `${summary.avgRating.toFixed(2)} ★` : '—'}
              tone="primary"
              loading={loading}
              hint={summary ? t('dash.feedback.ofResponses', '{n} responses').replace('{n}', String(summary.responseCount)) : undefined}
            />
            <StatCard
              label={t('dash.feedback.npsScore', 'NPS score')}
              value={summary ? String(summary.npsScore) : '—'}
              tone={summary ? npsTone(summary.npsScore) : 'default'}
              loading={loading}
              hint={summary ? t('dash.feedback.npsBase', '{n} rated likelihood').replace('{n}', String(summary.npsResponseCount)) : undefined}
            />
            <StatCard
              label={t('dash.feedback.responses', 'Responses')}
              value={summary ? String(summary.responseCount) : '—'}
              loading={loading}
            />
          </div>

          {/* Rating distribution */}
          <Panel title={t('dash.feedback.distribution', 'Rating distribution')}>
            {loading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : summary && summary.responseCount > 0 ? (
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = summary.ratingDistribution[String(star)] ?? 0;
                  const pct = Math.round((count / maxRating) * 100);
                  return (
                    <div key={star} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-sm text-text-secondary">{star} ★</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-text-secondary">{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-text-muted">{t('dash.feedback.noData', 'No feedback in this period yet.')}</p>
            )}
          </Panel>

          {/* Recent comments */}
          <Panel title={t('dash.feedback.recentComments', 'Recent comments')}>
            {loading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : comments.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-muted">{t('dash.feedback.noComments', 'No comments yet.')}</p>
            ) : (
              <ul className="space-y-3">
                {comments.slice(0, 25).map((r) => (
                  <li key={r.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-amber-400">{'★'.repeat(r.rating)}<span className="text-text-muted/40">{'★'.repeat(5 - r.rating)}</span></span>
                      {r.nps != null && <span className="text-xs text-text-muted">NPS {r.nps}</span>}
                      <span className="ml-auto text-xs text-text-muted">{fmtDateTime(r.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-text-primary">{r.comment}</p>
                    {(r.outletName || r.orderNumber) && (
                      <p className="mt-0.5 text-xs text-text-muted">
                        {r.outletName}{r.outletName && r.orderNumber ? ' · ' : ''}{r.orderNumber ? `#${r.orderNumber}` : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* All responses */}
          <Panel title={t('dash.feedback.allResponses', 'All responses')} bodyClassName="p-0">
            <TableWrap>
              <thead>
                <tr className="border-b border-border">
                  <th className={`${thCls} text-left`}>{t('dash.feedback.colDate', 'Date')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.feedback.colBranch', 'Branch')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.feedback.colOrder', 'Order')}</th>
                  <th className={`${thCls} text-center`}>{t('dash.feedback.colRating', 'Rating')}</th>
                  <th className={`${thCls} text-center`}>{t('dash.feedback.colNps', 'NPS')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.feedback.colComment', 'Comment')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <EmptyRow colSpan={6}>{t('dash.feedback.loading', 'Loading…')}</EmptyRow>}
                {!loading && responses.length === 0 && <EmptyRow colSpan={6}>{t('dash.feedback.noData', 'No feedback in this period yet.')}</EmptyRow>}
                {!loading && responses.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-sunken/30">
                    <td className={`${tdCls} whitespace-nowrap text-text-muted`}>{fmtDateTime(r.createdAt)}</td>
                    <td className={tdCls}>{r.outletName ?? '—'}</td>
                    <td className={`${tdCls} font-mono`}>{r.orderNumber ?? '—'}</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{r.rating} ★</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{r.nps != null ? r.nps : '—'}</td>
                    <td className={`${tdCls} max-w-xs truncate`} title={r.comment ?? ''}>{r.comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
      )}

      {tab === 'setup' && (
        <Panel title={t('dash.feedback.setupTitle', 'Feedback settings')}>
          {!config ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : (
            <div className="max-w-lg space-y-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">{t('dash.feedback.enable', 'Enable customer feedback')}</span>
                  <span className="block text-xs text-text-muted">{t('dash.feedback.enableHint', 'When on, customers can be asked to rate their service.')}</span>
                </span>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={config.sendOnPaid}
                  disabled={!config.enabled}
                  onChange={(e) => setConfig({ ...config, sendOnPaid: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">{t('dash.feedback.sendOnPaid', 'Send automatically when an order is paid')}</span>
                  <span className="block text-xs text-text-muted">{t('dash.feedback.sendOnPaidHint', 'A WhatsApp message with a feedback link is sent to the customer after payment.')}</span>
                </span>
              </label>

              <Field label={t('dash.feedback.thanksMessage', 'WhatsApp message')} hint={t('dash.feedback.thanksHint', 'Shown just before the feedback link.')}>
                <textarea
                  className="input-field"
                  rows={3}
                  value={config.thanksMessage}
                  onChange={(e) => setConfig({ ...config, thanksMessage: e.target.value })}
                />
              </Field>

              {/* Timing */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('dash.feedback.sendDelay', 'Send delay (minutes)')} hint={t('dash.feedback.sendDelayHint', '0 = send immediately after payment.')}>
                  <input type="number" min={0} className="input-field" value={config.sendDelayMinutes}
                    onChange={(e) => setConfig({ ...config, sendDelayMinutes: Number(e.target.value) })} />
                </Field>
                <Field label={t('dash.feedback.expiryDays', 'Link valid for (days)')} hint={t('dash.feedback.expiryHint', 'After this, the survey link expires.')}>
                  <input type="number" min={1} max={90} className="input-field" value={config.expiryDays}
                    onChange={(e) => setConfig({ ...config, expiryDays: Number(e.target.value) })} />
                </Field>
              </div>

              {/* Alerts */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <p className="text-sm font-medium text-text-primary">{t('dash.feedback.alerts', 'Alerts')}</p>
                <div className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={config.alertThresholdRating != null}
                    onChange={(e) => setConfig({ ...config, alertThresholdRating: e.target.checked ? 2 : null })} />
                  <span>{t('dash.feedback.alertLowRating', 'Alert when rating is at or below')}</span>
                  <select className="input-field w-20 py-1" disabled={config.alertThresholdRating == null}
                    value={config.alertThresholdRating ?? 2}
                    onChange={(e) => setConfig({ ...config, alertThresholdRating: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ★</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={config.alertOnDetractor}
                    onChange={(e) => setConfig({ ...config, alertOnDetractor: e.target.checked })} />
                  <span>{t('dash.feedback.alertDetractor', 'Alert on NPS detractors (score 0–6)')}</span>
                </label>
              </div>

              {/* Question builder */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-text-primary">{t('dash.feedback.questions', 'Survey questions')}</p>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => setConfig({
                      ...config,
                      questions: [...config.questions, { id: `q_${config.questions.length + 1}`, type: 'text', label: '', enabled: true }],
                    })}
                  >
                    {t('dash.feedback.addQuestion', '+ Add question')}
                  </button>
                </div>
                <div className="space-y-2">
                  {config.questions.map((q, i) => {
                    const isRating = q.type === 'rating';
                    const update = (p: Partial<FeedbackQuestion>) => {
                      const questions = config.questions.slice();
                      questions[i] = { ...q, ...p };
                      setConfig({ ...config, questions });
                    };
                    return (
                      <div key={q.id + i} className="flex items-center gap-2">
                        <span className="badge bg-surface-sunken text-text-secondary text-xs w-16 justify-center capitalize">{q.type}</span>
                        <input
                          className="input-field flex-1 py-1"
                          value={q.label}
                          placeholder={t('dash.feedback.questionLabel', 'Question text')}
                          onChange={(e) => update({ label: e.target.value })}
                        />
                        <label className="flex items-center gap-1 text-xs text-text-secondary" title={isRating ? t('dash.feedback.ratingRequired', 'The star rating is always shown.') : ''}>
                          <input type="checkbox" checked={q.enabled} disabled={isRating} onChange={(e) => update({ enabled: e.target.checked })} />
                          {t('dash.feedback.on', 'On')}
                        </label>
                        <button
                          className="text-rose-600 disabled:opacity-30"
                          disabled={isRating}
                          title={isRating ? t('dash.feedback.ratingRequired', 'The star rating is always shown.') : t('dash.feedback.removeQuestion', 'Remove')}
                          onClick={() => setConfig({ ...config, questions: config.questions.filter((_, j) => j !== i) })}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-text-muted">{t('dash.feedback.questionsHint', 'The star rating is always collected. Toggle NPS or add short text questions; disabled questions are hidden from customers.')}</p>
              </div>

              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={saveConfig} disabled={saving}>
                  {saving ? t('dash.feedback.saving', 'Saving…') : t('dash.feedback.save', 'Save settings')}
                </button>
                {savedMsg && <span className="text-sm text-green-600">{savedMsg}</span>}
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
