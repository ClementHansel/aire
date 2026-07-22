'use client';

import { useState } from 'react';
import { Eye, EyeOff, Sun, Moon } from 'lucide-react';
import { api } from '@/lib/api';
import { setSession, type AuthSession } from '@/lib/auth';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

// ─── Demo quick-login (retired from the branded login screen) ──────────────
// The demo accounts still exist in the seed data and sign in fine through the
// normal email/password form below — no special UI needed:
//   owner@demo.com               / password123  (tenant owner)
//   cashier1@sudirman.demo.com   / password123  (cashier -> POS)
//   superadmin@aire.com          / password123  (platform super admin)
// Kept here, commented out, in case a quick-login shortcut is wanted again.
//
// const DEMO_OUTLET_ID = '22222222-2222-2222-2222-222222222201';
//
// const DEMO_LOGINS = [
//   { label: 'Super Admin', email: 'superadmin@aire.com', password: 'password123', desc: 'Platform-wide administration' },
//   { label: 'Tenant Owner', email: 'owner@demo.com', password: 'password123', desc: 'Full business owner access' },
//   { label: 'Cashier', email: 'cashier1@sudirman.demo.com', password: 'password123', desc: 'Signs straight into the Point of Sale' },
// ];
//
// const DEMO_PUBLIC = [
//   { label: 'Queue Board', href: `/queue-board/${DEMO_OUTLET_ID}`, desc: 'Live outlet display', icon: '📺' },
// ];

/** Top-right light/dark toggle. Renders nothing if the tenant has dark mode disabled. */
function ThemeToggleButton() {
  const { theme, toggleTheme, canToggleTheme } = useTheme();
  const { t } = useI18n();
  if (!canToggleTheme) return null;
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('auth.login.toggleTheme', 'Toggle theme')}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  );
}

function LoginScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    setError('');
    try {
      const session = await api.post<AuthSession>('/auth/login', { email: loginEmail, password: loginPassword });
      setSession(session);
      // A cashier signs in and goes straight to POS, pinned to their own branch
      // (outletId comes back on the session). The URL branch segment is only a
      // label — the backend resolves the operating branch from the session — so
      // no POS device token is needed for a personal cashier login. Owners/admins
      // land on the hub.
      // Honor a safe, same-site ?next= (e.g. a shared /docs deep link) first.
      let next = '';
      if (typeof window !== 'undefined') {
        const raw = new URLSearchParams(window.location.search).get('next');
        if (raw && /^\/[^/]/.test(raw)) next = raw; // relative, single-leading-slash only
      }
      const dest = next || (session.user.role === 'cashier'
        ? `/pos/${session.user.outletId ?? 'pos'}/new-order`
        : '/hub');
      window.location.href = dest;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('auth.login.failed', 'Login failed');
      setError(message.includes('credentials') || message.includes('401') ? t('auth.login.invalidCreds', 'Invalid email or password') : message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doLogin(email, password);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-surface lg:flex-row">
      {/* ── Left brand panel (hidden below lg, mobile gets a compact chip instead) ── */}
      <div className="relative hidden overflow-hidden bg-[#3d3fa3] px-12 py-10 text-[#fffbf0] lg:flex lg:w-1/2 lg:flex-col lg:justify-between">
        {/* Decorative depth — subtle, tasteful, purely ambient */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#fffbf0]/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-[#fffbf0]/5 blur-3xl" />

        <div className="relative flex items-center gap-2">
          <img src="/brand/airin-wordmark.svg" alt="Airin" className="h-6 w-auto" />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight xl:text-4xl">
            {t('auth.login.headline', 'Otomasi bisnis Anda dengan AI Agent')}
          </h2>
          <p className="mt-4 text-sm text-[#fffbf0]/80 xl:text-base">
            {t('auth.login.tagline', 'Platform Agentic AI untuk operasional bisnis — cerdas, otomatis, 24/7.')}
          </p>
        </div>

        <p className="relative text-xs text-[#fffbf0]/60">
          © {new Date().getFullYear()} Airin. {t('auth.login.rightsReserved', 'Seluruh hak cipta dilindungi.')}
        </p>
      </div>

      {/* ── Right form panel ── */}
      <div className="relative flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 xl:px-24">
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggleButton />
        </div>

        {/* Compact brand chip shown only when the blue panel is hidden (mobile/tablet) */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="inline-flex items-center rounded-xl bg-[#3d3fa3] px-3 py-2">
            <img src="/brand/airin-wordmark.svg" alt="Airin" className="h-5 w-auto" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-bold text-text-primary">{t('auth.login.welcome', 'Selamat datang')}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t('auth.login.welcomeSubtitle', 'Masuk ke akun Anda untuk melanjutkan')}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-primary">{t('auth.login.email', 'Email')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text-primary">{t('auth.login.password', 'Password')}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="input-field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('auth.login.hidePassword', 'Hide password') : t('auth.login.showPassword', 'Show password')}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted transition-colors hover:text-text-secondary focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <a href="/reset-password" className="text-sm font-medium text-[#3d3fa3] hover:text-[#2e2f82]">
                {t('auth.login.forgotPassword', 'Lupa password?')}
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-[#3d3fa3] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#33347f] focus:outline-none focus:ring-2 focus:ring-[#3d3fa3]/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t('auth.login.signingIn', 'Signing in...') : t('auth.login.signIn', 'Masuk')}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-text-muted">{t('auth.login.needHelp', 'Butuh bantuan? Hubungi tim Anda.')}</p>
            <a href="/docs" className="mt-1 inline-block text-sm font-medium text-[#3d3fa3] hover:text-[#2e2f82]">
              {t('auth.login.readDocs', 'Baca dokumentasi')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <ThemeProvider>
      <LoginScreen />
    </ThemeProvider>
  );
}
