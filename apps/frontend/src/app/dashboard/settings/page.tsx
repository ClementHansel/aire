'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { BrandingSettingsPanel } from '@/components/branding/BrandingSettingsPanel';
import { useI18n } from '@/lib/i18n';
import { useBranding } from '@/contexts/BrandingContext';
import { api, ApiError } from '@/lib/api';
import {
  fetchSettings, patchSettings, currentTenantId,
  type PublicTenantSettings, type SettingsPatch,
} from '@/lib/settings';
import WhatsAppSection from './WhatsAppSection';
import { AIAutomationSection } from './AIAutomationSection';
import AutomationControlsSection, {
  type AutomationControlsState, type AutomationKey, type ApprovalMode,
} from './AutomationControlsSection';
import { DeviceDiscoverySection, type OutletOption } from './DeviceDiscoverySection';
import { BranchBridgesSection } from './BranchBridgesSection';
import PaymentGatewaySection from './PaymentGatewaySection';
import { AccountingPeriodsSection } from './AccountingPeriodsSection';

/**
 * Tenant Settings — a tabbed console. Every tab is wired to a real backend and
 * the saved values are honored by the runtime (LLM router, scheduled analysis,
 * WhatsApp agent, payment gateway). "Payment Gateway" is folded in here.
 */

type TabId = 'general' | 'whatsapp' | 'ai' | 'automation' | 'devices' | 'payment' | 'accounting';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'ai', label: 'AI Automation' },
  { id: 'automation', label: 'Automation Controls' },
  { id: 'devices', label: 'Devices' },
  { id: 'payment', label: 'Payment Gateway' },
  { id: 'accounting', label: 'Accounting Periods' },
];

export default function SettingsPage() {
  const { t } = useI18n();
  const { tenantCode } = useBranding();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabId) || 'general';

  const [tab, setTab] = useState<TabId>(TABS.some((x) => x.id === initialTab) ? initialTab : 'general');
  const [settings, setSettings] = useState<PublicTenantSettings | null>(null);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [loadError, setLoadError] = useState('');
  const [banner, setBanner] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [s, o] = await Promise.all([
        fetchSettings(),
        api.get<OutletOption[]>('/outlets').catch(() => [] as OutletOption[]),
      ]);
      setSettings(s);
      setOutlets(o);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Central save: PATCH, refresh local state, surface friendly errors (incl. the
  // 422 "prerequisite not met" the backend raises when enabling a toggle too early).
  const save = useCallback(async (patch: SettingsPatch): Promise<PublicTenantSettings> => {
    try {
      const next = await patchSettings(patch);
      setSettings(next);
      setBanner({ kind: 'success', text: 'Settings saved.' });
      return next;
    } catch (err) {
      const text = err instanceof ApiError && (err.details as { details?: { missing?: string } })?.details?.missing
        ? prerequisiteMessage((err.details as { details: { missing: string } }).details.missing)
        : err instanceof Error ? err.message : 'Save failed';
      setBanner({ kind: 'error', text });
      throw err;
    }
  }, []);

  const controlsState: AutomationControlsState | null = settings && {
    ai_enabled: settings.ai_enabled,
    llm_provider: settings.llm_provider,
    llm_api_key_configured: settings.llm_api_key_set,
    toggles: {
      campaigns: settings.automation_toggles.campaigns,
      retention_offers: settings.automation_toggles.retention_offers,
      pricing_suggestions: settings.automation_toggles.pricing_suggestions,
      anomaly_alerts: settings.automation_toggles.anomaly_alerts,
      queue_optimization: settings.automation_toggles.queue_optimization,
      membership_recommendations: settings.automation_toggles.membership_recommendations,
    },
    approval_modes: settings.approval_modes as Record<AutomationKey, ApprovalMode>,
  };

  return (
    <div data-testid="settings-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary" data-testid="settings-page-title">{t('dash.settings.title', 'Settings')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('dash.settings.subtitle', 'Configure your business, automation, integrations, and payments.')}</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-border mb-6">
        {TABS.map((x) => (
          <button
            key={x.id}
            data-testid={`settings-tab-${x.id}`}
            onClick={() => { setTab(x.id); setBanner(null); }}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              tab === x.id
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {loadError && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{loadError}</div>}
      {banner && (
        <div className={`rounded-lg p-3 text-sm mb-4 border ${banner.kind === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {banner.text}
        </div>
      )}

      <div className="max-w-3xl space-y-6">
        {tab === 'general' && (
          <>
            <section className="card" data-testid="settings-section-identity">
              <h2 className="section-title">{t('dash.settings.tenantIdentity', 'Business identity')}</h2>
              <p className="section-description">{t('dash.settings.tenantCodeDesc', 'Your business code — the fixed prefix of every membership number. Assigned automatically and not editable.')}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs text-text-muted">{t('dash.settings.membershipCodePrefix', 'Membership code prefix')}</span>
                <code className="px-2 py-1 rounded bg-surface-sunken font-mono text-sm text-text-primary tracking-widest">{tenantCode || '—'}</code>
              </div>
            </section>
            <section data-testid="settings-section-branding">
              <div className="mb-3">
                <h2 className="section-title">{t('dash.settings.branding', 'Branding & Appearance')}</h2>
                <p className="section-description">{t('dash.settings.brandingDesc', 'Customize your logo, colors, and fonts. Changes apply across the app.')}</p>
              </div>
              <BrandingSettingsPanel />
            </section>
          </>
        )}

        {tab === 'whatsapp' && (settings
          ? <WhatsAppSection
              phone={settings.whatsapp_phone}
              tokenSet={settings.whatsapp_token_set}
              onSave={async (phone, token) => {
                await save({ whatsapp_phone: phone, ...(token ? { whatsapp_token_encrypted: token } : {}) });
              }}
            />
          : <LoadingCard />)}

        {tab === 'ai' && (settings
          ? <AIAutomationSection
              ai_enabled={settings.ai_enabled}
              llm_provider={settings.llm_provider}
              llm_api_key_encrypted={settings.llm_api_key_set ? 'set' : null}
              schedule_interval={settings.schedule_interval}
              onSave={({ ai_enabled, llm_provider, llm_api_key, schedule_interval }) => {
                save({
                  ai_enabled, llm_provider, schedule_interval,
                  ...(llm_api_key && llm_api_key !== '••••••••' ? { llm_api_key_encrypted: llm_api_key } : {}),
                }).catch(() => {});
              }}
            />
          : <LoadingCard />)}

        {tab === 'automation' && (controlsState
          ? <AutomationControlsSection
              state={controlsState}
              onToggleChange={(key, enabled) => { save({ automation_toggles: { [key]: enabled } }).catch(() => {}); }}
              onApprovalModeChange={(key, mode) => { save({ approval_modes: { [key]: mode } }).catch(() => {}); }}
            />
          : <LoadingCard />)}

        {tab === 'devices' && (
          <>
            <BranchBridgesSection outlets={outlets} />
            <DeviceDiscoverySection tenantId={safeTenantId()} outlets={outlets} />
          </>
        )}

        {tab === 'payment' && <PaymentGatewaySection />}

        {tab === 'accounting' && <AccountingPeriodsSection />}
      </div>
    </div>
  );
}

function LoadingCard() {
  return <div className="card text-sm text-text-muted">Loading…</div>;
}

function safeTenantId(): string {
  try { return currentTenantId(); } catch { return ''; }
}

function prerequisiteMessage(missing: string): string {
  switch (missing) {
    case 'ai_enabled':
      return 'Enable AI Automation first (AI Automation tab) before turning on this capability.';
    case 'llm_api_key':
      return 'Add your OpenRouter API key (AI Automation tab) before enabling this capability.';
    default:
      return `Prerequisite not met: ${missing}.`;
  }
}
