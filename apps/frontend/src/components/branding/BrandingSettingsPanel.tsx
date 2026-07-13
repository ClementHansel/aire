'use client';

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Palette, Save, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBranding } from '@/contexts/BrandingContext';
import { normalizeBrandingConfig, type BrandingConfig } from '@/lib/color-utils';
import { HexColorPicker } from './HexColorPicker';
import { CompanyLogo } from './CompanyLogo';
import { FontThemePicker } from './FontThemePicker';

/** Max logo upload size. The backend enforces 5 MB; keep the UI limit tighter. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function BrandingSettingsPanel() {
  const { branding: current, logoUrl, refreshBranding } = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [branding, setBranding] = useState<BrandingConfig>(normalizeBrandingConfig(current));
  const [previewLogo, setPreviewLogo] = useState<string | null>(logoUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { setBranding(normalizeBrandingConfig(current)); }, [current]);
  useEffect(() => { setPreviewLogo(logoUrl); }, [logoUrl]);

  const updateColor = (mode: 'light' | 'dark', key: keyof BrandingConfig['light'], hex: string) => {
    setBranding((prev) => ({ ...prev, [mode]: { ...prev[mode], [key]: hex } }));
  };

  const saveBranding = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await api.put('/branding', branding);
      await refreshBranding();
      setMsg('Branding saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setErr(''); setMsg('');
    if (file.size > MAX_LOGO_BYTES) {
      setErr('Logo is too large. Please use an image under 2 MB.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<{ logo_url: string }>('/branding/logo', fd);
      setPreviewLogo(res.logo_url);
      await refreshBranding();
      setMsg('Logo uploaded.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to upload logo');
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    setErr(''); setMsg('');
    try {
      await api.delete('/branding/logo');
      setPreviewLogo(null);
      await refreshBranding();
      setMsg('Logo removed.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove logo');
    }
  };

  return (
    <div className="space-y-6" data-testid="branding-settings">
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700">{err}</div>}
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-xs text-green-700">{msg}</div>}

      {/* Logo */}
      <div className="surface-elevated p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold">Company Logo</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Shows in the sidebar and app shell. PNG, JPG, WEBP, or SVG (max 2 MB).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {previewLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewLogo} alt="Logo" className="h-16 w-auto max-w-[200px] object-contain rounded-md border border-border p-2 bg-background" />
          ) : (
            <CompanyLogo size="lg" subtitle="" />
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gold/10 text-gold text-xs font-medium hover:bg-gold/20 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Uploading…' : 'Upload Logo'}
            </button>
            {previewLogo && (
              <button
                type="button"
                onClick={() => void removeLogo()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="surface-elevated p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold">App Colors</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-luxury text-muted-foreground">Light theme</p>
            <HexColorPicker label="Primary" value={branding.light.primary} onChange={(v) => updateColor('light', 'primary', v)} />
            <HexColorPicker label="Background" value={branding.light.background} onChange={(v) => updateColor('light', 'background', v)} />
            <HexColorPicker label="Accent" value={branding.light.accent} onChange={(v) => updateColor('light', 'accent', v)} />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-luxury text-muted-foreground">Dark theme</p>
            <HexColorPicker label="Primary" value={branding.dark.primary} onChange={(v) => updateColor('dark', 'primary', v)} />
            <HexColorPicker label="Background" value={branding.dark.background} onChange={(v) => updateColor('dark', 'background', v)} />
            <HexColorPicker label="Accent" value={branding.dark.accent} onChange={(v) => updateColor('dark', 'accent', v)} />
          </div>
        </div>
      </div>

      <FontThemePicker value={branding.fonts} onChange={(fonts) => setBranding((prev) => ({ ...prev, fonts }))} />

      {/* Dark mode policy */}
      <div className="surface-elevated p-6 space-y-4">
        <h3 className="text-sm font-semibold">Dark Mode</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={branding.dark_mode_enabled}
            onChange={(e) => setBranding((prev) => ({ ...prev, dark_mode_enabled: e.target.checked }))}
            className="h-4 w-4 rounded border-input"
          />
          <span className="text-sm">Let users switch between light and dark themes</span>
        </label>

        {branding.dark_mode_enabled ? (
          <div className="space-y-2 pl-7">
            <p className="text-xs text-muted-foreground">Default theme for new users:</p>
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBranding((prev) => ({ ...prev, default_theme: mode }))}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium border capitalize',
                    branding.default_theme === mode ? 'bg-gold/10 border-gold text-gold' : 'border-input hover:bg-accent',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2 pl-7">
            <p className="text-xs text-muted-foreground">Forced theme for everyone:</p>
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBranding((prev) => ({ ...prev, forced_theme: mode }))}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium border capitalize',
                    branding.forced_theme === mode ? 'bg-gold/10 border-gold text-gold' : 'border-input hover:bg-accent',
                  )}
                >
                  {mode} only
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void saveBranding()}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving…' : 'Save Branding'}
      </button>
    </div>
  );
}
