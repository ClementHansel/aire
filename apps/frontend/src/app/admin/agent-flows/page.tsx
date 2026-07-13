'use client';

/**
 * Platform-admin catalog of n8n agent flows. The super-admin builds workflows in
 * the hosted n8n editor (link below) and registers each one here by pasting its
 * Production Webhook URL. Tenants then pick from these in their own dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, Field, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls } from '@/components/dashboard/ui';

type FlowKind = 'whatsapp' | 'automation';
interface AgentFlow {
  id: string; label: string; description: string | null; kind: FlowKind;
  webhookUrl: string; enabled: boolean; createdAt: string; updatedAt: string;
}

// n8n editor URL. In production this is baked in at build time via
// NEXT_PUBLIC_N8N_URL (e.g. https://flows.useairin.id). In local dev that build
// arg is usually unset, so fall back to a localhost n8n when we detect we're
// running on localhost — otherwise the link points at the prod host, which isn't
// reachable in dev. Override the local port with NEXT_PUBLIC_N8N_URL if it differs.
function resolveN8nUrl(): string {
  if (process.env.NEXT_PUBLIC_N8N_URL) return process.env.NEXT_PUBLIC_N8N_URL;
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'http://localhost:5678';
  }
  return 'https://flows.useairin.id';
}

const emptyForm = { label: '', description: '', kind: 'whatsapp' as FlowKind, webhookUrl: '', enabled: true };

function FlowModal({ initial, onClose, onSaved }: { initial: AgentFlow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial
    ? { label: initial.label, description: initial.description ?? '', kind: initial.kind, webhookUrl: initial.webhookUrl, enabled: initial.enabled }
    : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = { ...form, description: form.description || null };
    try {
      if (initial) await api.put(`/agent-flows/${initial.id}`, payload);
      else await api.post('/agent-flows', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={initial ? 'Edit flow' : 'Register flow'}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="flow-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Register'}</button>
        </>
      }
    >
      <form id="flow-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Label"><input className="input-field" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required placeholder="Front-desk WhatsApp assistant" /></Field>
        <Field label="Description"><input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Greets, answers FAQ, checks membership status" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className="input-field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FlowKind })}>
              <option value="whatsapp">WhatsApp assistant</option><option value="automation">Automation</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm mt-7">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
          </label>
        </div>
        <Field label="n8n Production Webhook URL" hint="Copy this from the Webhook (Production) node in n8n.">
          <input className="input-field" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} required placeholder="https://flows.useairin.id/webhook/aire-whatsapp" />
        </Field>
      </form>
    </Modal>
  );
}

export default function AdminAgentFlowsPage() {
  const [flows, setFlows] = useState<AgentFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: AgentFlow | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<AgentFlow | null>(null);
  // Resolved on the client so the localhost dev fallback can read window.location.
  const [n8nUrl, setN8nUrl] = useState('https://flows.useairin.id');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setFlows(await api.get<AgentFlow[]>('/agent-flows')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    setN8nUrl(resolveN8nUrl());
    load();
  }, [load]);

  const toggle = async (f: AgentFlow) => {
    try { await api.patch(`/agent-flows/${f.id}`, { enabled: !f.enabled }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const remove = async () => {
    if (!deleting) return;
    try { await api.delete(`/agent-flows/${deleting.id}`); setDeleting(null); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); setDeleting(null); }
  };

  return (
    <div className="space-y-6" data-testid="admin-agent-flows">
      <PageHeader
        title="Agent Flows"
        subtitle="Build drag-and-drop agent workflows in n8n, then register each one here so tenants can select it. Tenants never edit n8n — they just choose a flow, name their agents, and use their own API key."
        actions={
          <>
            <a className="btn-secondary" href={n8nUrl} target="_blank" rel="noreferrer">Open n8n builder ↗</a>
            <button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ Register flow</button>
          </>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={4} cols={5} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>Label</th>
                <th className={cn(thCls, 'text-left')}>Kind</th>
                <th className={cn(thCls, 'text-left')}>Webhook</th>
                <th className={cn(thCls, 'text-left')}>Status</th>
                <th className={cn(thCls, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {flows.length === 0 ? (
                <EmptyRow colSpan={5}>No flows registered yet. Build one in n8n, then click “Register flow”.</EmptyRow>
              ) : flows.map((f) => (
                <tr key={f.id} className="hover:bg-surface-sunken/50">
                  <td className={tdCls}>
                    <p className="font-medium text-text-primary">{f.label}</p>
                    {f.description && <p className="text-xs text-text-muted">{f.description}</p>}
                  </td>
                  <td className={tdCls}><span className="badge bg-sky-50 text-sky-700 capitalize">{f.kind}</span></td>
                  <td className={cn(tdCls, 'max-w-[240px] truncate text-text-muted')} title={f.webhookUrl}>{f.webhookUrl}</td>
                  <td className={tdCls}>
                    <button onClick={() => toggle(f)} className={cn('badge text-xs', f.enabled ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}>
                      {f.enabled ? '● Enabled' : '○ Disabled'}
                    </button>
                  </td>
                  <td className={cn(tdCls, 'text-right whitespace-nowrap')}>
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: f })}>Edit</button>
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => setDeleting(f)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {modal.open && <FlowModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}

      {deleting && (
        <Modal
          title="Delete flow"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn-primary" onClick={remove}>Delete</button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">Delete “{deleting.label}” from the catalog? Tenants using it will fall back to the built-in assistant.</p>
        </Modal>
      )}
    </div>
  );
}
