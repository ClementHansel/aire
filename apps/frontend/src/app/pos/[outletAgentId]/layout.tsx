'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getPosDeviceToken, getPosOutletId, getPosOutletName, setPosDevice, validatePosToken, clearPosDevice,
} from '@/lib/posDevice';
import { isAuthenticated, setSession, type AuthSession } from '@/lib/auth';
import { api } from '@/lib/api';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { OfflineIndicator } from '@/components/shared/OfflineIndicator';
import { BrandingProvider, useBranding } from '@/contexts/BrandingContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

type Phase = 'checking' | 'no-device' | 'signin' | 'ready';

/** A device's pinned branch — the subset of PosDeviceContext this file needs. */
interface DeviceBranch { outletId: string; outletName: string; }

/** GET /api/me/pos-branch response — the operator's real selling branch. */
interface PosBranchInfo {
  outletId: string | null;
  outletName: string | null;
  source: 'shift' | 'home' | null;
}

/**
 * POS shell guard. A POS page only renders when (1) this device holds a valid,
 * active POS device token (pinning its branch) and (2) a cashier has signed in
 * with their own email + password. Children never mount until both hold, so the
 * pages' own "redirect to / when unauthenticated" checks never fire here.
 */
function PosGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');
  const [outletName, setOutletName] = useState<string>('');
  // Set when the device's pinned branch and the operator's actual open-shift
  // branch disagree — a cashier ringing sales into the wrong branch's books
  // is a finance problem, so this is surfaced rather than silently resolved.
  const [branchMismatch, setBranchMismatch] = useState<{ deviceName: string; shiftName: string } | null>(null);

  // Device registration (no-device phase)
  const [regInput, setRegInput] = useState('');
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState('');

  // Cashier sign-in (signin phase)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Guards state updates from a resolveBranch() call that's still in flight
  // after the component unmounted (route change, StrictMode double-effect).
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /**
   * The single authoritative branch resolution for the POS header — same
   * precedence for every entry path (initial mount, device registration,
   * cashier sign-in): device token (physically pins this terminal) → open
   * shift → home outlet. Always asks the server rather than trusting the
   * locally-cached device outlet name, which is only ever set by a device
   * registration and would otherwise leave the header blank or stale for a
   * session-only cashier (AIRIN-113).
   *
   * `deviceBranch` is passed when a device token is pinned; in that case the
   * device's name is what's shown, but the operator's real open-shift branch
   * (what order.service.ts actually books orders to) is still fetched to
   * catch a mismatch — see `branchMismatch` above.
   */
  const resolveBranch = async (deviceBranch: DeviceBranch | null) => {
    try {
      const info = await api.get<PosBranchInfo>('/me/pos-branch');
      if (!aliveRef.current) return;
      if (deviceBranch) {
        if (info.source === 'shift' && info.outletId && info.outletId !== deviceBranch.outletId) {
          setBranchMismatch({ deviceName: deviceBranch.outletName, shiftName: info.outletName ?? info.outletId });
        } else {
          setBranchMismatch(null);
        }
      } else {
        setOutletName(info.outletName ?? '');
        setBranchMismatch(null);
      }
    } catch {
      // A hiccup resolving the branch shouldn't block the cashier out of POS;
      // whatever name is already showing (device name, or blank) stands.
    } finally {
      if (aliveRef.current) setPhase('ready');
    }
  };

  useEffect(() => {
    const token = getPosDeviceToken();
    if (!token) {
      // Session-only cashier: a cashier who signed in on the main login lands
      // here with no device token. Resolve their real operating branch from
      // the server instead of the (empty, or stale-from-a-different-device)
      // cached name.
      if (isAuthenticated()) { void resolveBranch(null); return; }
      setPhase('no-device');
      return;
    }
    setOutletName(getPosOutletName() ?? '');
    validatePosToken(token)
      .then((ctx) => {
        if (!aliveRef.current) return;
        setPosDevice(token, ctx);
        setOutletName(ctx.outletName);
        if (isAuthenticated()) void resolveBranch({ outletId: ctx.outletId, outletName: ctx.outletName });
        else setPhase('signin');
      })
      .catch(() => {
        if (!aliveRef.current) return;
        clearPosDevice();
        setPhase('no-device');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    // Accept either a raw token or a full launch URL pasted in.
    let token = regInput.trim();
    const m = token.match(/[?&]posToken=([^&\s]+)/);
    if (m) token = decodeURIComponent(m[1]!);
    if (!token) { setRegErr(t('pos.gate.needToken', 'Paste the launch URL or device token.')); return; }
    setRegBusy(true); setRegErr('');
    try {
      const ctx = await validatePosToken(token);
      setPosDevice(token, ctx);
      setOutletName(ctx.outletName);
      if (isAuthenticated()) await resolveBranch({ outletId: ctx.outletId, outletName: ctx.outletName });
      else setPhase('signin');
    } catch (e) {
      setRegErr(e instanceof Error ? e.message : 'Invalid device token');
    } finally { setRegBusy(false); }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && (body.message || body.error)) || t('pos.gate.signInFailed', 'Sign in failed'));
      setSession(body as AuthSession);
      // This sign-in form only ever renders on the device-token path (a
      // token was already validated to reach 'signin' — see the effect
      // above), so the device's outlet is read back from storage here.
      const deviceOutletId = getPosOutletId();
      const deviceOutletName = getPosOutletName();
      if (deviceOutletId && deviceOutletName) await resolveBranch({ outletId: deviceOutletId, outletName: deviceOutletName });
      else setPhase('ready');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('pos.gate.signInFailed', 'Sign in failed'));
    } finally { setBusy(false); }
  };

  // On flaky on-site wifi, warn the cashier the moment connectivity drops so a
  // failed sale/settlement isn't mistaken for success.
  //
  // The tenant's branding (incl. dark-mode policy) is only fetched here, once
  // authenticated — BrandingProvider hits an auth-guarded endpoint, and
  // calling it during the pre-auth phases below would 401, which the shared
  // api client treats as a session expiry and hard-redirects to "/", bouncing
  // the cashier straight off this in-place registration/sign-in gate (the
  // exact thing this component exists to avoid — see the file doc comment).
  if (phase === 'ready') {
    return (
      <BrandingProvider>
        <TenantThemeGate>
          <OfflineIndicator />
          {branchMismatch && (
            <div className="bg-red-600 text-white text-xs sm:text-sm px-3 py-2 text-center font-medium">
              {t(
                'pos.gate.branchMismatch',
                'This terminal is registered to {device}, but your open shift is at {shift} — sales are being booked to {shift}.',
              )
                .replace(/\{device\}/g, branchMismatch.deviceName)
                .replace(/\{shift\}/g, branchMismatch.shiftName)}
            </div>
          )}
          {children}
        </TenantThemeGate>
      </BrandingProvider>
    );
  }

  const Shell = ({ children: inner }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <span className="inline-flex items-center justify-center w-14 h-14 bg-primary-500 rounded-2xl text-white text-2xl font-bold mb-3">A</span>
          <h1 className="text-xl font-bold text-text-primary">{t('pos.gate.title', 'Point of Sale')}</h1>
          {outletName && <p className="text-sm text-text-muted mt-1">{outletName}</p>}
        </div>
        {inner}
        <div className="flex justify-center mt-4"><LanguageToggle /></div>
      </div>
    </div>
  );

  // Pre-auth phases (checking / no-device / signin): still honor the
  // persisted theme (via the default, no-tenant-branding config — same
  // fallback admin/layout.tsx uses) without touching any authenticated
  // endpoint.
  let gateContent: React.ReactNode;

  if (phase === 'checking') {
    gateContent = <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('pos.gate.checking', 'Loading…')}</div>;
  } else if (phase === 'no-device') {
    gateContent = (
      <Shell>
        <div className="card space-y-3">
          <p className="text-sm text-text-secondary">
            {t('pos.gate.notRegistered', 'This terminal is not registered. Open the launch URL from Dashboard → POS Terminals, or paste it below.')}
          </p>
          {regErr && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{regErr}</div>}
          <form onSubmit={register} className="space-y-3">
            <input className="input-field text-xs font-mono" placeholder="https://…/pos/launch?posToken=…" value={regInput} onChange={(e) => setRegInput(e.target.value)} />
            <button className="btn-primary w-full" disabled={regBusy || !regInput.trim()}>{regBusy ? t('pos.gate.registering', 'Registering…') : t('pos.gate.register', 'Register this terminal')}</button>
          </form>
        </div>
      </Shell>
    );
  } else {
    // signin
    gateContent = (
      <Shell>
        <form onSubmit={signIn} className="card space-y-3">
          <p className="text-sm text-text-secondary">{t('pos.gate.cashierSignIn', 'Cashier sign in')}</p>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t('pos.gate.email', 'Email')}</label>
            <input className="input-field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t('pos.gate.password', 'Password')}</label>
            <input className="input-field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn-primary w-full" disabled={busy || !email || !password}>{busy ? t('pos.gate.signingIn', 'Signing in…') : t('pos.gate.signIn', 'Sign in')}</button>
          <button type="button" className="btn-ghost w-full text-xs" onClick={() => { clearPosDevice(); setPhase('no-device'); }}>{t('pos.gate.switchDevice', 'Not this branch? Re-register terminal')}</button>
        </form>
      </Shell>
    );
  }

  return <ThemeProvider>{gateContent}</ThemeProvider>;
}

/** Applies the tenant's dark-mode policy from branding to the theme provider.
 * Mirrors dashboard/layout.tsx's ThemeGate — POS previously rendered
 * identically in light and dark because no ThemeProvider wrapped it at all. */
function TenantThemeGate({ children }: { children: React.ReactNode }) {
  const { branding } = useBranding();
  return <ThemeProvider themeConfig={branding}>{children}</ThemeProvider>;
}

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <PosGate>{children}</PosGate>;
}
