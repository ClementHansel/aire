'use client';

/**
 * The on/off switch used across the AI Knowledge page — categories, per-item
 * visibility, and per-document enablement all read as the same control.
 */
export function MiniToggle({
  checked, onChange, disabled, big,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative shrink-0 ${big ? 'w-12 h-7' : 'w-9 h-5'} rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 ${big ? 'w-6 h-6' : 'w-4 h-4'} bg-white rounded-full transition-transform ${checked ? (big ? 'translate-x-5' : 'translate-x-4') : ''}`} />
    </button>
  );
}

export default MiniToggle;
