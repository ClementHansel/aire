'use client';

import { Type } from 'lucide-react';
import {
  FONT_THEME_PRESETS,
  GOOGLE_FONT_DISPLAY_GROUPS,
  GOOGLE_FONT_MONO,
  GOOGLE_FONT_SANS,
  applyBrandingFonts,
  findFontById,
  type FontThemeConfig,
  type GoogleFontOption,
} from '@/lib/google-fonts';
import { cn } from '@/lib/utils';

type Props = {
  value: FontThemeConfig;
  onChange: (fonts: FontThemeConfig) => void;
};

function FontSelect({
  label,
  hint,
  options,
  groups,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options?: GoogleFontOption[];
  groups?: { label: string; options: GoogleFontOption[] }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = findFontById(value);
  const renderOptions = (opts: GoogleFontOption[]) =>
    opts.map((opt) => (
      <option key={opt.id} value={opt.id} style={{ fontFamily: opt.family }}>
        {opt.label}
      </option>
    ));

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <p className="text-2xs text-muted-foreground">{hint}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
        style={{ fontFamily: selected?.family }}
      >
        {groups
          ? groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {renderOptions(group.options)}
              </optgroup>
            ))
          : renderOptions(options ?? [])}
      </select>
    </div>
  );
}

export function FontThemePicker({ value, onChange }: Props) {
  const activePreset = FONT_THEME_PRESETS.find(
    (p) => p.fonts.sans === value.sans && p.fonts.display === value.display && p.fonts.mono === value.mono,
  );

  const update = (next: FontThemeConfig) => {
    onChange(next);
    applyBrandingFonts(next);
  };

  return (
    <div className="surface-elevated p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Type className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-semibold">Font Theme</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Font 1 (body text), Font 2 (headings/display), and Font 3 (numbers/code) apply across the whole app.
      </p>

      {/* Presets */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-luxury text-muted-foreground">Quick presets</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FONT_THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => update(preset.fonts)}
              className={cn(
                'text-left rounded-lg border px-3 py-2.5 transition-colors',
                activePreset?.id === preset.id ? 'border-gold bg-gold/10' : 'border-input hover:bg-accent',
              )}
            >
              <p className="text-sm font-medium">{preset.name}</p>
              <p className="text-2xs text-muted-foreground mt-0.5">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Individual picks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2 border-t border-border">
        <FontSelect label="Font 1 — Body" hint="Body, labels, buttons" options={GOOGLE_FONT_SANS} value={value.sans} onChange={(sans) => update({ ...value, sans })} />
        <FontSelect label="Font 2 — Headings" hint="Headings, logo — sans or serif" groups={GOOGLE_FONT_DISPLAY_GROUPS} value={value.display} onChange={(display) => update({ ...value, display })} />
        <FontSelect label="Font 3 — Mono & Numbers" hint="Time, PIN, code, number tables" options={GOOGLE_FONT_MONO} value={value.mono} onChange={(mono) => update({ ...value, mono })} />
      </div>

      {/* Live preview */}
      <div className="rounded-lg border border-border bg-background p-4 space-y-2">
        <p className="text-2xs uppercase tracking-luxury text-muted-foreground">Preview</p>
        <p className="font-display text-xl font-semibold">The quick brown fox jumps over the lazy dog</p>
        <p className="text-sm">Body text uses Font 1. Everyone sees the same fonts once saved.</p>
        <p className="font-mono text-sm text-muted-foreground">08:30:00 · PIN · ABC-123</p>
      </div>
    </div>
  );
}
