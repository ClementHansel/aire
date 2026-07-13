'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHeader, Panel, Field } from '@/components/dashboard/ui';
import { DocumentDesigner } from '@/components/dashboard/DocumentDesigner';

type Symbology = 'CODE128' | 'EAN13' | 'QR';
type BarcodeTab = 'settings' | 'designer';

interface BarcodeConfig {
  enabled: boolean;
  symbology: Symbology;
  autoGenerate: boolean;
  scanAddsToCart: boolean;
  printLabelOnReceive: boolean;
}

const DEFAULT_CONFIG: BarcodeConfig = {
  enabled: false,
  symbology: 'CODE128',
  autoGenerate: false,
  scanAddsToCart: true,
  printLabelOnReceive: false,
};

/** A simple checkbox row used for the feature toggles. */
function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export default function BarcodeSettingsPage() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<BarcodeConfig | null>(null);
  const [tab, setTab] = useState<BarcodeTab>('settings');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<BarcodeConfig>('/barcode/config')
      .then((c) => setCfg({ ...DEFAULT_CONFIG, ...c }))
      .catch(() => setCfg(DEFAULT_CONFIG));
  }, []);

  // Deep-link support: /dashboard/barcode-settings?tab=designer
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'designer' || q === 'settings') setTab(q);
  }, []);

  // The label designer tab only exists while barcodes are enabled — fall back if turned off.
  useEffect(() => {
    if (cfg && !cfg.enabled && tab === 'designer') setTab('settings');
  }, [cfg, tab]);

  const patch = (p: Partial<BarcodeConfig>) => setCfg((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg('');
    try {
      const saved = await api.put<BarcodeConfig>('/barcode/config', cfg);
      setCfg({ ...DEFAULT_CONFIG, ...saved });
      setMsg(t('dash.barcodeSettings.saved', 'Saved.'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('dash.barcodeSettings.saveFailed', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return <div className="card text-sm text-text-muted max-w-md">{t('dash.barcodeSettings.loading', 'Loading…')}</div>;
  }

  const tabs: { key: BarcodeTab; label: string }[] = [
    { key: 'settings', label: t('dash.barcodeSettings.tabSettings', 'Settings') },
    ...(cfg.enabled ? [{ key: 'designer' as const, label: t('dash.barcodeSettings.tabDesigner', 'Label Designer') }] : []),
  ];

  return (
    <div>
      <PageHeader
        title={t('dash.barcodeSettings.title', 'Barcode')}
        subtitle={t('dash.barcodeSettings.subtitle', 'Turn on product barcodes to unlock scan-to-cart at the POS and the barcode label designer.')}
      />

      <div className="flex gap-1 border-b border-border mt-4 mb-6">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            data-testid={`barcode-tab-${tb.key}`}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === tb.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'designer' ? (
        <DocumentDesigner kind="label" showHeading={false} />
      ) : (
      <div className="max-w-2xl space-y-6">
      {msg && <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-sm text-sky-800">{msg}</div>}

      <Panel title={t('dash.barcodeSettings.feature', 'Feature')}>
        <Check
          label={t('dash.barcodeSettings.enable', 'Enable product barcodes')}
          hint={t('dash.barcodeSettings.enableHint', 'When on, products can carry a barcode, the POS can scan to add items to the cart, and the label designer appears.')}
          checked={cfg.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
      </Panel>

      {cfg.enabled && (
        <Panel title={t('dash.barcodeSettings.options', 'Options')}>
          <div className="space-y-4">
            <Field label={t('dash.barcodeSettings.symbology', 'Symbology')} hint={t('dash.barcodeSettings.symbologyHint', 'Barcode format used on printed labels.')}>
              <select className="input-field" value={cfg.symbology} onChange={(e) => patch({ symbology: e.target.value as Symbology })}>
                <option value="CODE128">CODE128</option>
                <option value="EAN13">EAN-13</option>
                <option value="QR">QR</option>
              </select>
            </Field>

            <div className="border-t border-border pt-2">
              <Check
                label={t('dash.barcodeSettings.autoGenerate', 'Auto-generate barcodes')}
                hint={t('dash.barcodeSettings.autoGenerateHint', 'New products without a barcode get a unique in-store EAN-13 automatically.')}
                checked={cfg.autoGenerate}
                onChange={(v) => patch({ autoGenerate: v })}
              />
              <Check
                label={t('dash.barcodeSettings.scanAddsToCart', 'Scan adds to cart at POS')}
                hint={t('dash.barcodeSettings.scanAddsToCartHint', 'Scanning a known product barcode at the POS adds it to the current order.')}
                checked={cfg.scanAddsToCart}
                onChange={(v) => patch({ scanAddsToCart: v })}
              />
              <Check
                label={t('dash.barcodeSettings.printLabelOnReceive', 'Print label on receive')}
                hint={t('dash.barcodeSettings.printLabelOnReceiveHint', 'Offer to print barcode labels when stock is received.')}
                checked={cfg.printLabelOnReceive}
                onChange={(v) => patch({ printLabelOnReceive: v })}
              />
            </div>
          </div>
        </Panel>
      )}

      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? t('dash.barcodeSettings.saving', 'Saving…') : t('dash.barcodeSettings.save', 'Save settings')}
      </button>
      </div>
      )}
    </div>
  );
}
