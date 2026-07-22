'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { en } from './locales/en';
import { id } from './locales/id';

export type Locale = 'en' | 'id';
const DICTS: Record<Locale, Record<string, string>> = { en, id };
const LS_KEY = 'aire_lang';

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a key; falls back to English, then the provided fallback, then the key. */
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<I18nCtx>({ locale: 'en', setLocale: () => {}, t: (k, f) => f ?? k });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  useEffect(() => {
    const s = (typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null) as Locale | null;
    if (s === 'en' || s === 'id') setLocaleState(s);
  }, []);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
  }, []);
  const t = useCallback(
    (key: string, fallback?: string) => DICTS[locale][key] ?? DICTS.en[key] ?? fallback ?? key,
    [locale],
  );
  return <LanguageContext.Provider value={{ locale, setLocale, t }}>{children}</LanguageContext.Provider>;
}

export function useI18n() { return useContext(LanguageContext); }

/** EN/ID toggle for the header. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div className={`inline-flex rounded-md border border-border overflow-hidden text-xs ${className}`} role="group" aria-label="Language">
      {(['en', 'id'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`px-2 py-1 font-semibold ${locale === l ? 'bg-primary-500 text-primary-foreground' : 'text-text-secondary hover:text-text-primary'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
