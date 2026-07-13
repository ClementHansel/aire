'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader,
  StatCard,
  Panel,
  TableWrap,
  thCls,
  tdCls,
  EmptyRow,
  Spinner,
  StatusBadge,
  Modal,
  Field,
  ErrorBanner,
  fmtDateTime,
} from '@/components/dashboard/ui';

type Segment = 'all' | 'members_active' | 'members_expired' | 'tag';

interface Campaign {
  id: string;
  name: string;
  message: string;
  audienceFilter: { segment: Segment; tag?: string | null; outletId?: string | null };
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled';
  scheduledAt: string | null;
  throttlePerMin: number;
  includeNoConsent: boolean;
  acknowledgedRisk: boolean;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  recipientCounts?: { queued: number; sent: number; failed: number; skipped_no_consent: number; total: number };
}

interface Recipient {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  error: string | null;
  sentAt: string | null;
}

interface Preview {
  total: number;
  consented: number;
  excludedNoConsent: number;
}

const SEGMENTS: { id: Segment; labelKey: string; fallback: string }[] = [
  { id: 'all', labelKey: 'dash.broadcast.segAll', fallback: 'All customers' },
  { id: 'members_active', labelKey: 'dash.broadcast.segActive', fallback: 'Active members' },
  { id: 'members_expired', labelKey: 'dash.broadcast.segExpired', fallback: 'Expired members' },
  { id: 'tag', labelKey: 'dash.broadcast.segTag', fallback: 'By tag' },
];

export default function BroadcastPage() {
  const { t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<Campaign[]>('/broadcast/campaigns');
      setCampaigns(rows);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.broadcast.loadError', 'Failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const totalSent = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
  const active = campaigns.filter((c) => c.status === 'sending' || c.status === 'paused').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t('dash.broadcast.title', 'WhatsApp Broadcast')}
        subtitle={t('dash.broadcast.subtitle', 'Send a marketing message to a segment of your customers, paced to reduce ban risk. Opt-in audiences only.')}
        actions={<button className="btn-primary" onClick={() => setCreateOpen(true)}>{t('dash.broadcast.new', '+ New campaign')}</button>}
      />

      <BanRiskBanner />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('dash.broadcast.statCampaigns', 'Campaigns')} value={String(campaigns.length)} loading={loading} />
        <StatCard label={t('dash.broadcast.statActive', 'Active / paused')} value={String(active)} tone={active > 0 ? 'warning' : 'default'} loading={loading} />
        <StatCard label={t('dash.broadcast.statSent', 'Messages sent')} value={String(totalSent)} tone="primary" loading={loading} />
      </div>

      <Panel title={t('dash.broadcast.campaigns', 'Campaigns')}>
        <TableWrap>
          <thead>
            <tr className="border-b border-border text-left">
              <th className={thCls}>{t('dash.broadcast.name', 'Name')}</th>
              <th className={thCls}>{t('dash.broadcast.status', 'Status')}</th>
              <th className={`${thCls} text-right`}>{t('dash.broadcast.progress', 'Progress')}</th>
              <th className={`${thCls} text-right`}>{t('dash.broadcast.sent', 'Sent')}</th>
              <th className={`${thCls} text-right`}>{t('dash.broadcast.failed', 'Failed')}</th>
              <th className={`${thCls} text-right`}>{t('dash.broadcast.skipped', 'Skipped')}</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <EmptyRow colSpan={7}><Spinner /></EmptyRow>}
            {!loading && campaigns.length === 0 && <EmptyRow colSpan={7}>{t('dash.broadcast.empty', 'No campaigns yet. Create one to start.')}</EmptyRow>}
            {!loading && campaigns.map((c) => {
              const done = (c.sentCount || 0) + (c.failedCount || 0);
              const pct = c.totalRecipients > 0 ? Math.round((done / c.totalRecipients) * 100) : 0;
              return (
                <tr key={c.id} className="hover:bg-surface-sunken/30">
                  <td className={tdCls}>
                    <button className="font-medium text-text-primary hover:text-primary-600" onClick={() => setDetailId(c.id)}>{c.name}</button>
                    <p className="text-xs text-text-muted">{segmentLabel(c.audienceFilter.segment, t)}</p>
                  </td>
                  <td className={tdCls}><StatusBadge status={c.status} /></td>
                  <td className={`${tdCls} text-right tabular-nums`}>{c.totalRecipients > 0 ? `${pct}%` : '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums text-green-600`}>{c.sentCount}</td>
                  <td className={`${tdCls} text-right tabular-nums text-rose-600`}>{c.failedCount}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-muted`}>{c.skippedCount}</td>
                  <td className={`${tdCls} text-right`}>
                    <button className="btn-ghost text-xs" onClick={() => setDetailId(c.id)}>{t('dash.broadcast.view', 'View')}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Panel>

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); load(); setDetailId(id); }} />}
      {detailId && <DetailModal id={detailId} onClose={() => { setDetailId(null); load(); }} onChanged={load} />}
    </div>
  );
}

function segmentLabel(seg: Segment, t: (k: string, d: string) => string): string {
  const s = SEGMENTS.find((x) => x.id === seg);
  return s ? t(s.labelKey, s.fallback) : seg;
}

/** Persistent, prominent ban-risk warning shown across the broadcast flow. */
function BanRiskBanner() {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden>⚠</span>
        {t('dash.broadcast.banTitle', 'WhatsApp ban risk — read before sending')}
      </p>
      <p className="mt-1.5 leading-relaxed">
        {t(
          'dash.broadcast.banBody',
          'Sending unsolicited or non-opted-in bulk messages, generating a high block/report rate, or messaging outside the 24-hour customer-service window without an approved template on the WhatsApp Business API can get your number SUSPENDED or permanently BANNED.',
        )}
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        <li>{t('dash.broadcast.banTip1', 'Message opted-in customers only.')}</li>
        <li>{t('dash.broadcast.banTip2', 'Use a conservative throttle (messages/min).')}</li>
        <li>{t('dash.broadcast.banTip3', 'Keep content personalized and template-style — avoid spammy blasts.')}</li>
      </ul>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [segment, setSegment] = useState<Segment>('members_active');
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const [throttle, setThrottle] = useState('20');
  const [scheduledAt, setScheduledAt] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Live audience preview whenever the segment/tag changes.
  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    const params = new URLSearchParams({ segment });
    if (segment === 'tag' && tag.trim()) params.set('tag', tag.trim());
    const run = setTimeout(() => {
      if (segment === 'tag' && !tag.trim()) { setPreview(null); setPreviewLoading(false); return; }
      api.get<Preview>(`/broadcast/audience/preview?${params.toString()}`)
        .then((p) => { if (!cancelled) setPreview(p); })
        .catch(() => { if (!cancelled) setPreview(null); })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(run); };
  }, [segment, tag]);

  const save = async () => {
    if (!name.trim()) { setErr(t('dash.broadcast.needName', 'Name is required')); return; }
    if (!message.trim()) { setErr(t('dash.broadcast.needMessage', 'Message is required')); return; }
    if (segment === 'tag' && !tag.trim()) { setErr(t('dash.broadcast.needTag', 'Tag is required for the tag segment')); return; }
    setSaving(true); setErr('');
    try {
      const created = await api.post<{ id: string }>('/broadcast/campaigns', {
        name: name.trim(),
        message: message.trim(),
        audienceFilter: { segment, tag: segment === 'tag' ? tag.trim() : undefined },
        throttlePerMin: Number(throttle) || 20,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('dash.broadcast.failed', 'Failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('dash.broadcast.newCampaign', 'New broadcast campaign')}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t('dash.broadcast.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.broadcast.saving', 'Saving…') : t('dash.broadcast.create', 'Create draft')}</button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <ErrorBanner message={err} onDismiss={() => setErr('')} />}

        <Field label={t('dash.broadcast.name', 'Campaign name')}>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={t('dash.broadcast.audience', 'Audience segment')}>
          <select className="input-field" value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
            {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{t(s.labelKey, s.fallback)}</option>)}
          </select>
        </Field>

        {segment === 'tag' && (
          <Field label={t('dash.broadcast.tag', 'Tag')} hint={t('dash.broadcast.tagHint', 'e.g. member, renewal, voucher')}>
            <input className="input-field" value={tag} onChange={(e) => setTag(e.target.value)} />
          </Field>
        )}

        {/* Live audience preview: consented vs excluded-no-consent */}
        <div className="rounded-lg border border-border bg-surface-sunken/40 p-3 text-sm">
          {previewLoading ? (
            <span className="flex items-center gap-2 text-text-muted"><Spinner /> {t('dash.broadcast.previewing', 'Estimating audience…')}</span>
          ) : preview ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span className="text-text-muted">{t('dash.broadcast.total', 'Total')}: <b className="text-text-primary tabular-nums">{preview.total}</b></span>
              <span className="text-green-600">{t('dash.broadcast.consented', 'Opted-in')}: <b className="tabular-nums">{preview.consented}</b></span>
              <span className="text-rose-600">{t('dash.broadcast.excluded', 'Excluded (no consent)')}: <b className="tabular-nums">{preview.excludedNoConsent}</b></span>
            </div>
          ) : (
            <span className="text-text-muted">{t('dash.broadcast.noPreview', 'No audience estimate available.')}</span>
          )}
        </div>

        <Field label={t('dash.broadcast.message', 'Message')} hint={t('dash.broadcast.messageHint', 'Use {name} to insert the customer name.')}>
          <textarea className="input-field" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('dash.broadcast.messagePlaceholder', 'Hi {name}, ...')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dash.broadcast.throttle', 'Throttle (msgs/min)')} hint={t('dash.broadcast.throttleHint', 'Lower is safer.')}>
            <input className="input-field tabular-nums" type="number" min={1} max={600} value={throttle} onChange={(e) => setThrottle(e.target.value)} />
          </Field>
          <Field label={t('dash.broadcast.schedule', 'Schedule (optional)')}>
            <input className="input-field" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [err, setErr] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [includeNoConsent, setIncludeNoConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        api.get<Campaign>(`/broadcast/campaigns/${id}`),
        api.get<Recipient[]>(`/broadcast/campaigns/${id}/recipients`),
      ]);
      setCampaign(c);
      setRecipients(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while sending so progress updates live.
  useEffect(() => {
    if (campaign?.status === 'sending') {
      if (!pollRef.current) pollRef.current = setInterval(refresh, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [campaign?.status, refresh]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true); setErr('');
    try {
      await api.post(`/broadcast/campaigns/${id}/${path}`, body);
      await refresh();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('dash.broadcast.failed', 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const canStart = campaign && (campaign.status === 'draft' || campaign.status === 'scheduled');
  const done = campaign ? (campaign.sentCount || 0) + (campaign.failedCount || 0) : 0;
  const pct = campaign && campaign.totalRecipients > 0 ? Math.round((done / campaign.totalRecipients) * 100) : 0;

  return (
    <Modal title={campaign ? campaign.name : t('dash.broadcast.loading', 'Loading…')} onClose={onClose} maxWidth="max-w-3xl">
      {err && <ErrorBanner message={err} onDismiss={() => setErr('')} />}
      {!campaign ? (
        <div className="py-8 text-center"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <BanRiskBanner />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-text-muted">{t('dash.broadcast.status', 'Status')}: <StatusBadge status={campaign.status} /></span>
            <span className="text-text-muted">{t('dash.broadcast.audience', 'Audience')}: <span className="text-text-primary">{segmentLabel(campaign.audienceFilter.segment, t)}</span></span>
            <span className="text-text-muted">{t('dash.broadcast.throttle', 'Throttle')}: <span className="text-text-primary tabular-nums">{campaign.throttlePerMin}/min</span></span>
            {campaign.startedAt && <span className="text-text-muted">{t('dash.broadcast.started', 'Started')}: <span className="text-text-primary">{fmtDateTime(campaign.startedAt)}</span></span>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('dash.broadcast.total', 'Total')} value={String(campaign.totalRecipients)} />
            <StatCard label={t('dash.broadcast.sent', 'Sent')} value={String(campaign.sentCount)} tone="positive" />
            <StatCard label={t('dash.broadcast.failed', 'Failed')} value={String(campaign.failedCount)} tone={campaign.failedCount > 0 ? 'negative' : 'default'} />
            <StatCard label={t('dash.broadcast.skipped', 'Skipped')} value={String(campaign.skippedCount)} />
          </div>

          {campaign.totalRecipients > 0 && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-text-muted"><span>{t('dash.broadcast.progress', 'Progress')}</span><span className="tabular-nums">{pct}%</span></div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-sunken/40 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.broadcast.message', 'Message')}</p>
            <p className="whitespace-pre-wrap text-sm text-text-primary">{campaign.message}</p>
          </div>

          {/* Start gate: acknowledge ban risk + optional include-no-consent */}
          {canStart && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>{t('dash.broadcast.ackLabel', 'I understand the WhatsApp policy & ban risk')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-text-secondary">
                <input type="checkbox" className="mt-0.5" checked={includeNoConsent} onChange={(e) => setIncludeNoConsent(e.target.checked)} />
                <span>{t('dash.broadcast.includeNoConsent', 'Include non-opted-in customers (not recommended — higher ban risk)')}</span>
              </label>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {canStart && (
              <button
                className="btn-primary"
                disabled={!acknowledged || busy}
                onClick={() => act('start', { acknowledgedRisk: acknowledged, includeNoConsent })}
              >
                {t('dash.broadcast.start', 'Start sending')}
              </button>
            )}
            {campaign.status === 'sending' && <button className="btn-secondary" disabled={busy} onClick={() => act('pause')}>{t('dash.broadcast.pause', 'Pause')}</button>}
            {campaign.status === 'paused' && <button className="btn-primary" disabled={busy} onClick={() => act('resume')}>{t('dash.broadcast.resume', 'Resume')}</button>}
            {['draft', 'scheduled', 'sending', 'paused'].includes(campaign.status) && (
              <button className="btn-secondary text-rose-600" disabled={busy} onClick={() => act('cancel')}>{t('dash.broadcast.cancelCampaign', 'Cancel campaign')}</button>
            )}
          </div>

          <Panel title={`${t('dash.broadcast.recipients', 'Recipients')} (${recipients.length})`} bodyClassName="p-0">
            <TableWrap>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={thCls}>{t('dash.broadcast.recipient', 'Recipient')}</th>
                  <th className={thCls}>{t('dash.broadcast.phone', 'Phone')}</th>
                  <th className={thCls}>{t('dash.broadcast.status', 'Status')}</th>
                  <th className={thCls}>{t('dash.broadcast.detail', 'Detail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recipients.length === 0 && <EmptyRow colSpan={4}>{t('dash.broadcast.noRecipients', 'No recipients yet. Start the campaign to materialize the audience.')}</EmptyRow>}
                {recipients.slice(0, 500).map((r) => (
                  <tr key={r.id}>
                    <td className={tdCls}>{r.name || '—'}</td>
                    <td className={`${tdCls} font-mono text-xs`}>{r.phone}</td>
                    <td className={tdCls}><StatusBadge status={r.status === 'skipped_no_consent' ? 'skipped' : r.status} /></td>
                    <td className={`${tdCls} text-xs text-text-muted`}>{r.error || (r.sentAt ? fmtDateTime(r.sentAt) : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
      )}
    </Modal>
  );
}
