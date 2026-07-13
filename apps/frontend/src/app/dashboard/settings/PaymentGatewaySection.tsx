'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Payment Gateway section (folded into Settings). Per-tenant online payment
 * processor credentials — provider, sandbox toggle, live API key, webhook secret.
 * Wired to /api/payment-config (secrets are write-only; GET returns set/not-set).
 * Not to be confused with "Payment Methods" (the POS tender buttons).
 */

interface Cfg { provider: string; hasApiKey: boolean; hasWebhookSecret: boolean; sandbox: boolean }

export default function PaymentGatewaySection() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [provider, setProvider] = useState('midtrans');
  const [sandbox, setSandbox] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () =>
    api.get<Cfg>('/payment-config')
      .then((c) => { setCfg(c); setProvider(c.provider || 'midtrans'); setSandbox(c.sandbox); })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      // Sandbox uses the "mock" key so charges auto-confirm without a live gateway.
      const body = sandbox
        ? { provider, apiKey: 'mock', webhookSecret: webhookSecret.trim() || undefined }
        : { provider, apiKey: apiKey.trim() || undefined, webhookSecret: webhookSecret.trim() || undefined };
      const c = await api.put<Cfg>('/payment-config', body);
      setCfg(c); setApiKey(''); setWebhookSecret(''); setMsg(t('dash.paymentSettings.saved', 'Saved.'));
    } catch (e) { setMsg(e instanceof Error ? e.message : t('dash.paymentSettings.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <section data-testid="payment-gateway-section" className="card space-y-4">
      <div>
        <h2 className="section-title">{t('dash.paymentSettings.title', 'Payment Gateway')}</h2>
        <p className="section-description">
          {t('dash.paymentSettings.intro1', 'Per-tenant online payment gateway. Use ')}
          <span className="font-medium">{t('dash.paymentSettings.sandbox', 'Sandbox')}</span>
          {t('dash.paymentSettings.intro2', ' for testing (charges auto-confirm); switch off and enter your live API key to go live.')}
        </p>
      </div>

      {msg && <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-sm text-sky-800">{msg}</div>}

      {cfg && (
        <div className="rounded-lg border border-border p-3 text-sm text-text-secondary">
          {t('dash.paymentSettings.current', 'Current:')}{' '}
          <span className="font-medium text-text-primary capitalize">{cfg.provider}</span>
          {cfg.sandbox
            ? <span className="badge bg-amber-50 text-amber-700 ml-2">{t('dash.paymentSettings.sandbox', 'Sandbox')}</span>
            : <span className="badge bg-green-50 text-green-700 ml-2">{t('dash.paymentSettings.live', 'Live')}</span>}
          <span className="ml-2">· {t('dash.paymentSettings.apiKeyLabel', 'API key:')} {cfg.hasApiKey ? t('dash.paymentSettings.set', 'set') : t('dash.paymentSettings.notSet', 'not set')} · {t('dash.paymentSettings.webhookSecretLabel', 'Webhook secret:')} {cfg.hasWebhookSecret ? t('dash.paymentSettings.set', 'set') : t('dash.paymentSettings.notSet', 'not set')}</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('dash.paymentSettings.provider', 'Provider')}</label>
          <select className="input-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="midtrans">Midtrans</option>
            <option value="xendit">Xendit</option>
            <option value="stripe">Stripe</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
          {t('dash.paymentSettings.sandboxMode', 'Sandbox (test) mode — payments auto-confirm, no live gateway call')}
        </label>
        {!sandbox && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">{t('dash.paymentSettings.liveApiKey', 'Live API key')}</label>
              <input type="password" className="input-field" placeholder={t('dash.paymentSettings.leaveBlank', 'leave blank to keep current')} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('dash.paymentSettings.webhookSecret', 'Webhook secret')}</label>
              <input type="password" className="input-field" placeholder={t('dash.paymentSettings.leaveBlank', 'leave blank to keep current')} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
              <p className="text-xs text-text-muted mt-1">{t('dash.paymentSettings.callbackHint', 'Set the gateway callback to')} <span className="font-mono">/api/payments/webhook/{provider}</span></p>
            </div>
          </>
        )}
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? t('dash.paymentSettings.saving', 'Saving…') : t('dash.paymentSettings.save', 'Save')}
        </button>
      </div>
    </section>
  );
}
