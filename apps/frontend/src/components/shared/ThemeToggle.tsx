'use client';

/**
 * Shared light/dark toggle.
 *
 * Renders nothing when the tenant has dark mode disabled (the theme is then
 * forced by branding — see ThemeContext), so a surface can drop it in
 * unconditionally.
 *
 * The login page, hub and admin shell each had their own copy of this button;
 * the tenant dashboard and the POS had none at all, which is why "belum ada
 * switchnya" (Samuel 2026-07-30). One component now serves every surface.
 */

import { Moon, Sun } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/contexts/ThemeContext';

export function ThemeToggle({ className = '', showLabel = false }: {
  className?: string;
  /** Show the target theme's name next to the icon (sidebar/menu contexts). */
  showLabel?: boolean;
}) {
  const { theme, toggleTheme, canToggleTheme } = useTheme();
  const { t } = useI18n();
  if (!canToggleTheme) return null;

  const label = theme === 'dark' ? t('common.lightMode', 'Light mode') : t('common.darkMode', 'Dark mode');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('common.toggleTheme', 'Toggle theme')}
      title={label}
      data-testid="theme-toggle"
      className={
        showLabel
          ? `btn-ghost text-xs justify-start inline-flex items-center gap-2 ${className}`
          : `inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-300 ${className}`
      }
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
      {showLabel && <span>{label}</span>}
    </button>
  );
}
