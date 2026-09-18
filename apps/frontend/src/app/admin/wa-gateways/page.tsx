'use client';

/**
 * WhatsApp gateways — which WAHA container serves which tenant. Super-admin only.
 *
 * Why this page exists: the WAHA image we run is tier CORE, which serves exactly
 * ONE session and it must be named 'default'. So a session name cannot address a
 * second tenant's line — that line lives on its own container, and the backend
 * has to be told which one. Registering the container here is what makes a
 * tenant's WhatsApp genuinely its own rather than shared.
 *
 * It is platform-owned rather than tenant-editable because `baseUrl` is a URL
 * the backend fetches: a tenant-settable one would be an SSRF hole.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import {
  PageHeader, Panel, Modal, Field, ErrorBanner, Spinner,
  TableWrap, EmptyRow, thCls, tdCls,
} from '@/components/dashboard/ui';

interface WaGateway {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  isActive: boolean;
  notes: string | null;
  linesAssigned: number;
}

interface TenantWaTransport {
  tenantId: string;
  tenantName: string;
  gatewayId: string | null;
  gatewayName: string | null;
  wahaSession: string | null;
  waNumber: string | null;
  webhookPath: string | null;
}

interface ProbeResult {
  reachable: boolean;
  tier?: string;
  version?: string;
  sessions?: { name: string; status: string }[];
  error?: string;
}

interface FormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  notes: string;
}
const EMPTY: FormState = { name: '', baseUrl: '', apiKey: '', isActive: true, notes: '' };

function GatewayModal({ initial, onClose, onSaved }: {
  initial: WaGateway | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? { name: initial.name, baseUrl: initial.baseUrl, apiKey: '', isActive: initial.isActive, notes: initial.notes ?? '' }
      : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      // An omitted apiKey keeps the stored one, so only send it when typed.
      const body: Record<string, unknown> = {
        name: form.name, baseUrl: form.baseUrl, isActive: form.isActive, notes: form.notes || null,
      };
      if (form.apiKey) body.apiKey = form.apiKey;
      if (initial) await api.put(`/admin/wa-gateways/${initial.id}`, body);
      else await api.post('/admin/wa-gateways', body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the gateway');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Register a WhatsApp gateway'} onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Name" hint="How this container is referred to in the admin UI.">
          <input className="input-field" value={form.name} placeholder="waha-kalibrasi"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Base URL" hint="As the backend reaches it — usually the docker service name, e.g. http://waha-kalibrasi:3000">
          <input className="input-field" value={form.baseUrl} placeholder="http://waha-kalibrasi:3000"
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
        </Field>
        <Field
          label={`API key${initial?.apiKeyConfigured ? ' (stored — leave blank to keep)' : ''}`}
          hint="The container's WHATSAPP_API_KEY. Sent as X-Api-Key on every call."
        >
          <input className="input-field" type="password" value={form.apiKey}
            placeholder={initial?.apiKeyConfigured ? '••••••••' : 'Enter the gateway API key'}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </Field>
        <Field label="Notes">
          <input className="input-field" value={form.notes} placeholder="Which phone is paired, who owns it…"
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active — when off, every line on this gateway reports not connected
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !form.name || !form.baseUrl}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function WaGatewaysPage() {
  const [gateways, setGateways] = useState<WaGateway[]>([]);
  const [transports, setTransports] = useState<TenantWaTransport[]>([]);
  const [probes, setProbes] = useState<Record<string, ProbeResult | 'loading'>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WaGateway | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [gw, tr] = await Promise.all([
        api.get<WaGateway[]>('/admin/wa-gateways'),
        api.get<TenantWaTransport[]>('/admin/wa-transports'),
      ]);
      setGateways(gw); setTransports(tr);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load gateways');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthenticated()) void load(); }, [load]);

  const probe = async (id: string) => {
    setProbes((p) => ({ ...p, [id]: 'loading' }));
    try {
      const result = await api.get<ProbeResult>(`/admin/wa-gateways/${id}/probe`);
      setProbes((p) => ({ ...p, [id]: result }));
    } catch (e) {
      setProbes((p) => ({ ...p, [id]: { reachable: false, error: e instanceof Error ? e.message : 'probe failed' } }));
    }
  };

  const remove = async (gw: WaGateway) => {
    if (!confirm(`Delete gateway "${gw.name}"? Lines using it must be reassigned first.`)) return;
    try { await api.delete(`/admin/wa-gateways/${gw.id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the gateway'); }
  };

  const assign = async (tenantId: string, gatewayId: string) => {
    setError('');
    try {
      await api.put(`/admin/tenants/${tenantId}/wa-gateway`, { gatewayId: gatewayId || null });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reassign the gateway');
    }
  };

  const rotate = async (t: TenantWaTransport) => {
    if (!confirm(
      `Issue a new inbound webhook token for ${t.tenantName}?\n\n`
      + `The current URL stops working immediately — the gateway's WHATSAPP_HOOK_URL `
      + `must be updated to the new one, or this tenant stops receiving messages.`,
    )) return;
    try { await api.post(`/admin/tenants/${t.tenantId}/wa-webhook-token`, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not rotate the token'); }
  };

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp gateways"
        subtitle="Which WAHA container serves which tenant. A tenant on its own gateway has its own WhatsApp line; tenants sharing one gateway share a line."
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
            Register gateway
          </button>
        }
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <Panel
        title="Registered gateways"
        description="The platform default gateway (the WAHA_URL in the backend's env) is not listed here — it is what a tenant with no gateway assigned uses."
      >
        {loading ? <div className="p-6"><Spinner /></div> : (
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Base URL</th>
                  <th className={thCls}>API key</th>
                  <th className={thCls}>Lines</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Live check</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {gateways.length === 0 && (
                  <EmptyRow colSpan={7}>
                    No extra gateways yet. Every tenant is on the platform default container — which,
                    on WAHA Core, means they would share one WhatsApp line.
                  </EmptyRow>
                )}
                {gateways.map((gw) => {
                  const p = probes[gw.id];
                  return (
                    <tr key={gw.id} className="border-b border-border last:border-0">
                      <td className={tdCls}>{gw.name}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{gw.baseUrl}</td>
                      <td className={tdCls}>
                        {gw.apiKeyConfigured
                          ? <span className="text-green-600 dark:text-green-400">stored</span>
                          : <span className="text-text-muted">none</span>}
                      </td>
                      <td className={tdCls}>{gw.linesAssigned}</td>
                      <td className={tdCls}>
                        {gw.isActive
                          ? <span className="text-green-600 dark:text-green-400">active</span>
                          : <span className="text-amber-600 dark:text-amber-400">inactive</span>}
                      </td>
                      <td className={tdCls}>
                        {p === 'loading' ? <Spinner className="w-4 h-4" />
                          : p ? (
                            p.reachable
                              ? (
                                <span className="text-xs">
                                  <span className="text-green-600 dark:text-green-400">reachable</span>
                                  {p.tier && <> · tier {p.tier}</>}
                                  {p.version && <> · {p.version}</>}
                                  <br />
                                  <span className="text-text-muted">
                                    {p.sessions?.length
                                      ? p.sessions.map((s) => `${s.name}: ${s.status}`).join(', ')
                                      : 'no sessions'}
                                  </span>
                                </span>
                              )
                              : <span className="text-xs text-red-600 dark:text-red-400">{p.error ?? 'unreachable'}</span>
                          ) : <button className="btn-ghost text-xs" onClick={() => probe(gw.id)}>Check</button>}
                      </td>
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        <button className="btn-ghost text-xs" onClick={() => { setEditing(gw); setShowModal(true); }}>Edit</button>
                        <button className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={() => remove(gw)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Per-tenant transport"
        description="Each tenant's line: its gateway, its session name, and the inbound URL that gateway must POST to. Two tenants on the SAME gateway with the same session name are sharing one WhatsApp line."
      >
        {loading ? <div className="p-6"><Spinner /></div> : (
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thCls}>Tenant</th>
                  <th className={thCls}>Gateway</th>
                  <th className={thCls}>Session</th>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Inbound webhook URL</th>
                </tr>
              </thead>
              <tbody>
                {transports.length === 0 && <EmptyRow colSpan={5}>No tenants.</EmptyRow>}
                {transports.map((t) => {
                  // Same gateway + same session as another tenant = one shared line.
                  const shared = transports.some((o) =>
                    o.tenantId !== t.tenantId
                    && (o.gatewayId ?? null) === (t.gatewayId ?? null)
                    && !!o.wahaSession && o.wahaSession === t.wahaSession);
                  return (
                    <tr key={t.tenantId} className="border-b border-border last:border-0">
                      <td className={tdCls}>{t.tenantName}</td>
                      <td className={tdCls}>
                        <select
                          className="input-field text-xs py-1"
                          value={t.gatewayId ?? ''}
                          onChange={(e) => assign(t.tenantId, e.target.value)}
                        >
                          <option value="">Platform default (WAHA_URL)</option>
                          {gateways.map((gw) => <option key={gw.id} value={gw.id}>{gw.name}</option>)}
                        </select>
                      </td>
                      <td className={tdCls}>
                        {t.wahaSession
                          ? (
                            <span className={shared ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                              {t.wahaSession}
                              {shared && <span className="block text-xs">shares this line with another tenant</span>}
                            </span>
                          )
                          : <span className="text-text-muted text-xs">not configured</span>}
                      </td>
                      <td className={tdCls}>{t.waNumber ?? <span className="text-text-muted text-xs">—</span>}</td>
                      <td className={tdCls}>
                        {t.webhookPath ? (
                          <div className="flex items-center gap-2">
                            <code className="text-xs break-all">{t.webhookPath}</code>
                            <button className="btn-ghost text-xs" onClick={() => copy(t.webhookPath!, t.tenantId)}>
                              {copied === t.tenantId ? 'Copied' : 'Copy'}
                            </button>
                            <button className="btn-ghost text-xs" onClick={() => rotate(t)}>Rotate</button>
                          </div>
                        ) : (
                          <button className="btn-ghost text-xs" onClick={() => rotate(t)}>Issue token</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="px-5 pb-4 text-xs text-text-muted">
          Set each container&apos;s <code>WHATSAPP_HOOK_URL</code> to its tenant&apos;s URL above, prefixed with the
          backend origin. The token is what identifies the line: WAHA Core names every session
          &quot;default&quot;, so the session name cannot tell tenants apart, and it is public anyway.
        </p>
      </Panel>

      {showModal && (
        <GatewayModal
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); void load(); }}
        />
      )}
    </div>
  );
}
