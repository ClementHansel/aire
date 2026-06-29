'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ThemeMode } from '@/lib/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThemeContextValue {
  /** Current active theme mode */
  mode: ThemeMode;
  /** Toggle between light and dark modes */
  toggle: () => void;
  /** Set a specific theme mode */
  setMode: (mode: ThemeMode) => void;
  /** Whether the current mode was set by system preference (not explicit user choice) */
  isSystemPreference: boolean;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Default theme mode if no preference is stored. Defaults to 'light'. */
  defaultMode?: ThemeMode;
  /** localStorage key for persisting the theme preference */
  storageKey?: string;
  /** Whether to detect and follow system (OS) color scheme preference */
  enableSystemDetection?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY_DEFAULT = 'aire-theme-mode';
const THEME_ATTRIBUTE = 'data-theme';
const TRANSITION_ATTRIBUTE = 'data-theme-transition';

// ─── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * ThemeProvider manages dark/light mode for the AIRE platform.
 *
 * - Persists user preference to localStorage (Req 42.3)
 * - Detects system preference via matchMedia (prefers-color-scheme)
 * - Applies theme via data-theme attribute on <html> without page reload (Req 42.7)
 * - Default mode is Light (Req 42.2)
 */
export function ThemeProvider({
  children,
  defaultMode = 'light',
  storageKey = STORAGE_KEY_DEFAULT,
  enableSystemDetection = true,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);
  const [isSystemPreference, setIsSystemPreference] = useState(true);

  // Initialize from stored preference or system preference
  useEffect(() => {
    const stored = getStoredTheme(storageKey);
    if (stored) {
      setModeState(stored);
      setIsSystemPreference(false);
    } else if (enableSystemDetection) {
      const systemMode = getSystemPreference();
      if (systemMode) {
        setModeState(systemMode);
        setIsSystemPreference(true);
      }
    }
  }, [storageKey, enableSystemDetection]);

  // Listen for system preference changes (only when user hasn't set explicit preference)
  useEffect(() => {
    if (!enableSystemDetection) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      const stored = getStoredTheme(storageKey);
      if (!stored) {
        // Only follow system preference if user hasn't set an explicit preference
        setModeState(e.matches ? 'dark' : 'light');
        setIsSystemPreference(true);
      }
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [enableSystemDetection, storageKey]);

  // Apply theme to DOM (Req 42.7: without page reload)
  useEffect(() => {
    const root = document.documentElement;

    // Enable smooth transition
    root.setAttribute(TRANSITION_ATTRIBUTE, '');

    // Apply theme attribute
    root.setAttribute(THEME_ATTRIBUTE, mode);

    // Remove transition attribute after animation completes to avoid
    // interfering with other transitions
    const timeout = setTimeout(() => {
      root.removeAttribute(TRANSITION_ATTRIBUTE);
    }, 350);

    return () => clearTimeout(timeout);
  }, [mode]);

  const setMode = useCallback(
    (newMode: ThemeMode) => {
      setModeState(newMode);
      setIsSystemPreference(false);
      persistTheme(storageKey, newMode);
    },
    [storageKey],
  );

  const toggle = useCallback(() => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
  }, [mode, setMode]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({ mode, toggle, setMode, isSystemPreference }),
    [mode, toggle, setMode, isSystemPreference],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to access and control the current theme mode.
 * Must be used within a ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function getStoredTheme(key: string): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark') return stored;
    return null;
  } catch {
    return null;
  }
}

function persistTheme(key: string, mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, mode);
  } catch {
    // localStorage unavailable — graceful degradation
  }
}

function getSystemPreference(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    return mediaQuery.matches ? 'dark' : 'light';
  } catch {
    return null;
  }
}
