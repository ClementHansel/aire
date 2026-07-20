'use client';

import { useEffect, useState } from 'react';
import {
  getPosDeviceToken, getPosOutletName, setPosDevice, validatePosToken, clearPosDevice,
} from '@/lib/posDevice';
import { isAuthenticated, setSession, type AuthSession } from '@/lib/auth';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { OfflineIndicator } from '@/components/shared/OfflineIndicator';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

type Phase = 'checking' | 'no-device' | 'signin' | 'ready';

/**
 * POS shell guard. A POS page only renders when (1) this device holds a valid,
 * active POS device token (pinning its branch) and (2) a cashier has signed in
 * with their own email + password. Children never mount until both hold, so the
 * pages' own "redirect to / when unauthenticated" checks never fire here.
 */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');
  const [outletName, setOutletName] = useState<string>('');

  // Device registration (no-device phase)
  const [regInput, setRegInput] = useState('');
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState('');

  // Cashier sign-in (signin phase)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const token = getPosDeviceToken();
    setOutletName(getPosOutletName() ?? '');
    if (!token) {
      // Session-only cashier: a cashier who signed in on the main login lands
      // here with no device token. Let them straight through — the POS pages
      // resolve their operating branch from the session (open shift → branch
      // context → user.outletId). Shared terminals with no session still get
      // the register-this-terminal screen.
      if (isAuthenticated()) { setPhase('ready'); return; }
      setPhase('no-device');
      return;
    }
    let alive = true;
    validatePosToken(token)
      .then((ctx) => {
        if (!alive) return;
        setPosDevice(token, ctx);
        setOutletName(ctx.outletName);
        setPhase(isAuthenticated() ? 'ready' : 'signin');
      })
      .catch(() => {
        if (!alive) return;
        clearPosDevice();
        setPhase('no-device');
      });
    return () => { alive = false; };
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
      setPhase(isAuthenticated() ? 'ready' : 'signin');
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
      setPhase('ready');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('pos.gate.signInFailed', 'Sign in failed'));
    } finally { setBusy(false); }
  };

  // On flaky on-site wifi, warn the cashier the moment connectivity drops so a
  // failed sale/settlement isn't mistaken for success.
  if (phase === 'ready') return <><OfflineIndicator />{children}</>;

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

  if (phase === 'checking') {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('pos.gate.checking', 'Loading…')}</div>;
  }

  if (phase === 'no-device') {
    return (
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
  }

  // signin
  return (
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
