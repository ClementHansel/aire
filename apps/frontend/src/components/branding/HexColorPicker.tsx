'use client';

import { isValidHex, normalizeHex } from '@/lib/color-utils';

type Props = {
  label: string;
  value: string;
  onChange: (hex: string) => void;
};

/**
 * Simple hex color field: a native swatch picker plus an editable hex input.
 * Kept dependency-free (no react-colorful) to match aire's stack.
 */
export function HexColorPicker({ label, value, onChange }: Props) {
  const safe = isValidHex(value) ? normalizeHex(value) : '#000000';
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          spellCheck={false}
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>
    </div>
  );
}
