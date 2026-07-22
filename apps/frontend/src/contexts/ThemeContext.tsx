'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BrandingConfig } from '@/lib/color-utils';

type Theme = 'light' | 'dark';

interface ThemeConfig {
  dark_mode_enabled: boolean;
  forced_theme: Theme;
  default_theme: Theme;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  canToggleTheme: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = 'aire-theme';

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  dark_mode_enabled: true,
  forced_theme: 'light',
  default_theme: 'light',
};

/** The real (persisted / tenant-forced) theme — client-only, since it reads
 * localStorage. Only ever call this from an effect or an event handler, never
 * from render: the root layout's blocking theme-init script already applies
 * this same value to the DOM before paint, and `useState`'s render-time
 * initializer below stays SSR-safe on purpose (see comment there). */
function resolveRealTheme(config: ThemeConfig): Theme {
  if (!config.dark_mode_enabled) return config.forced_theme;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode, etc.) — fall through to default */
  }
  return config.default_theme;
}

/** Applies a resolved theme straight to the DOM + localStorage. Called from
 * effects/handlers only (never bound to a `theme`-keyed effect that could
 * fire once with a stale default) so it never stomps the theme-init script's
 * pre-paint class with a momentarily-wrong value. */
function applyTheme(theme: Theme, persist: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  try {
    if (persist) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({
  children,
  themeConfig = DEFAULT_THEME_CONFIG,
}: {
  children: ReactNode;
  themeConfig?: Pick<BrandingConfig, 'dark_mode_enabled' | 'forced_theme' | 'default_theme'>;
}) {
  const config: ThemeConfig = {
    dark_mode_enabled: themeConfig.dark_mode_enabled ?? true,
    forced_theme: themeConfig.forced_theme === 'dark' ? 'dark' : 'light',
    default_theme: themeConfig.default_theme === 'dark' ? 'dark' : 'light',
  };

  const canToggleTheme = config.dark_mode_enabled;

  // IMPORTANT: this must resolve to the *same* value on the server and on the
  // client's first (hydrating) render — reading localStorage or the DOM here
  // would make them disagree and throw a hydration mismatch (React #418) the
  // moment any themed element (e.g. the Sun/Moon toggle icon) renders. The
  // root layout's blocking script already paints the real persisted theme
  // before hydration, so there's no visible flash; this state is reconciled
  // to the real value in the effect below immediately after mount.
  const [theme, setThemeState] = useState<Theme>(config.default_theme);

  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const real = resolveRealTheme(configRef.current);
    setThemeState((prev) => (prev === real ? prev : real));
    applyTheme(real, configRef.current.dark_mode_enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.dark_mode_enabled, config.forced_theme, config.default_theme]);

  const setTheme = (next: Theme) => {
    if (!canToggleTheme) return;
    setThemeState(next);
    applyTheme(next, true);
  };

  const toggleTheme = () => {
    if (!canToggleTheme) return;
    setThemeState((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      applyTheme(next, true);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, canToggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
