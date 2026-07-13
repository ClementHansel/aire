'use client';

/**
 * Horizontal numbered step indicator shared by the tenant onboarding wizard and
 * the admin create-tenant wizard. Mirrors the look of DeviceScanWizard's <ol>.
 */
export function StepIndicator({ labels, step }: { labels: string[]; step: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs" data-testid="wizard-steps">
      {labels.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                step === n
                  ? 'bg-primary-500 text-white'
                  : step > n
                    ? 'bg-green-100 text-green-700'
                    : 'bg-surface-sunken text-text-muted'
              }`}
            >
              {step > n ? '✓' : n}
            </span>
            <span className={step === n ? 'font-medium text-text-primary' : 'text-text-muted'}>{label}</span>
            {n < labels.length && <span className="text-text-muted">·</span>}
          </li>
        );
      })}
    </ol>
  );
}
