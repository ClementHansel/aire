'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  dark_mode_enabled: true,
  forced_theme: 'light',
  default_theme: 'light',
};

function resolveInitialTheme(config: ThemeConfig): Theme {
  if (typeof window === 'undefined') return config.default_theme;
  if (!config.dark_mode_enabled) return config.forced_theme;
  const stored = localStorage.getItem('aire-theme') as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return config.default_theme;
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
  const [theme, setThemeState] = useState<Theme>(() => resolveInitialTheme(config));

  useEffect(() => {
    setThemeState(resolveInitialTheme(config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.dark_mode_enabled, config.forced_theme, config.default_theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    if (canToggleTheme) {
      localStorage.setItem('aire-theme', theme);
    } else {
      localStorage.removeItem('aire-theme');
    }
  }, [theme, canToggleTheme]);

  const setTheme = (next: Theme) => {
    if (!canToggleTheme) return;
    setThemeState(next);
  };

  const toggleTheme = () => {
    if (!canToggleTheme) return;
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
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
