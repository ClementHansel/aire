'use client';

import { useCallback, useEffect, useState } from 'react';
import { Home, CreditCard, Ticket, Car, UtensilsCrossed, Receipt, ListOrdered, CalendarPlus, RefreshCw, LogOut, User } from 'lucide-react';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';
import { useResolveTenant } from '@/lib/resolveTenant';
import { portalApi, getPortalToken, setPortalToken, clearPortalToken, PortalAuthError } from '@/lib/portalApi';
import { MembershipCard, type CardTemplate } from '@/components/dashboard/MembershipCard';

interface Plate { plate: string; brand?: string; model?: string }
interface Membership {
  id: string; planName: string; status: string; startDate: string; endDate: string;
  usesCount: number; maxUses: number; dailyLimit: number; plates: Plate[];
}
interface Voucher { id: string; code: string; type: string; value: number; expiresAt: string; isUsed: boolean }
interface MemberResp {
  customer: { id: string; name: string; phone: string; membershipNumber?: string; plates: Plate[] };
  memberships: Membership[];
  vouchers?: Voucher[];
}
interface PublicMenuItem { id: string; name: string; category: string; businessUnit: string; price: number }
interface PublicMenu { tenantName: string; services: PublicMenuItem[]; products?: PublicMenuItem[]; plans: { name: string; durationMonths: number; price: number }[] }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function mmYY(endDate?: string): string {
  if (!endDate) return '';
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

type Tab = 'home' | 'card' | 'history' | 'vouchers' | 'vehicles' | 'menu' | 'queue' | 'book' | 'renew' | 'profile';
interface PortalOrder { orderNumber: string; date: string; total: number; status: string; services: string | null }
interface Branch { id: string; name: string }
interface QueueEntry { position: number; plate: string | null; vehicle: string | null; status: string; mine: boolean }
interface Plan { id: string; name: string; durationMonths: number; price: number }
interface Booking { id: string; serviceName: string | null; scheduledAt: string; status: string; plate: string | null; outletName: string | null }
interface MenuService { id: string; name: string; category: string; businessUnit: string; price: number }

export default function PortalPage() {
  const { id: resolvedId, status } = useResolveTenant();
  const tenantId = resolvedId ?? '';
  const { t } = useI18n();
  const brand = usePublicBranding(resolvedId ?? undefined);

  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [me, setMe] = useState<MemberResp | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [loadErr, setLoadErr] = useState('');

  const loadMe = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const m = await portalApi<MemberResp>(resolvedId, '/portal/me');
      setMe(m); setAuthed(true); setLoadErr('');
    } catch (e) {
      if (e instanceof PortalAuthError) { setAuthed(false); return; }
      setLoadErr(e instanceof Error ? e.message : 'Failed to load');
      setAuthed(true);
    }
  }, [resolvedId]);

  useEffect(() => {
    if (!resolvedId) return;
    if (getPortalToken(resolvedId)) loadMe();
    else setAuthed(false);
  }, [resolvedId, loadMe]);

  const signOut = () => { clearPortalToken(tenantId); setMe(null); setAuthed(false); };

  if (status === 'notfound') {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('cust.notFound', 'This page is not available.')}</div>;
  }
  if (status === 'loading' || authed === null) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('portal.loading', 'Loading…')}</div>;
  }
  if (!authed) {
    return <PortalLogin tenantId={tenantId} companyName={brand.companyName} logoUrl={brand.logoUrl} onAuthed={loadMe} />;
  }

  const NAV: { key: Tab; label: string; icon: typeof Home }[] = [
    { key: 'home', label: t('portal.nav.home', 'Home'), icon: Home },
    { key: 'card', label: t('portal.nav.card', 'Card'), icon: CreditCard },
    { key: 'history', label: t('portal.nav.history', 'History'), icon: Receipt },
    { key: 'vouchers', label: t('portal.nav.vouchers', 'Vouchers'), icon: Ticket },
    { key: 'vehicles', label: t('portal.nav.vehicles', 'Vehicles'), icon: Car },
    { key: 'book', label: t('portal.nav.book', 'Book'), icon: CalendarPlus },
    { key: 'menu', label: t('portal.nav.menu', 'Menu'), icon: UtensilsCrossed },
    { key: 'queue', label: t('portal.nav.queue', 'Queue'), icon: ListOrdered },
    { key: 'renew', label: t('portal.nav.renew', 'Renew'), icon: RefreshCw },
    { key: 'profile', label: t('portal.nav.profile', 'Profile'), icon: User },
  ];
  // Mobile bottom-nav shows the 5 primary tabs; the rest are reachable from Home + the desktop rail.
  const MOBILE_KEYS: Tab[] = ['home', 'card', 'book', 'queue', 'menu'];
  const mobileNav = NAV.filter((n) => MOBILE_KEYS.includes(n.key));

  return (
    <div className="min-h-screen bg-surface flex flex-col md:flex-row">
      {/* Desktop side rail */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border bg-surface-raised p-4 gap-1">
        <Brand companyName={brand.companyName} logoUrl={brand.logoUrl} />
        <nav className="mt-4 flex flex-col gap-1">
          {NAV.map((n) => (
            <button key={n.key} onClick={() => setTab(n.key)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors ${tab === n.key ? 'bg-primary-500 text-white' : 'text-text-secondary hover:bg-surface-sunken'}`}>
              <n.icon className="w-4 h-4" />{n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between pt-4">
          <LanguageToggle />
          <button onClick={signOut} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"><LogOut className="w-3.5 h-3.5" />{t('portal.signOut', 'Sign out')}</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-surface-raised sticky top-0 z-10">
        <Brand companyName={brand.companyName} logoUrl={brand.logoUrl} compact />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button onClick={signOut} aria-label={t('portal.signOut', 'Sign out')} className="text-text-muted"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 max-w-3xl w-full mx-auto">
        {loadErr && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{loadErr}</div>}
        {me && tab === 'home' && <HomeView me={me} go={setTab} />}
        {me && tab === 'card' && <CardView me={me} tenantId={tenantId} />}
        {me && tab === 'history' && <HistoryView tenantId={tenantId} />}
        {me && tab === 'vouchers' && <VouchersView me={me} />}
        {me && tab === 'vehicles' && <VehiclesView me={me} tenantId={tenantId} onChanged={loadMe} />}
        {tab === 'menu' && <MenuView tenantId={tenantId} />}
        {tab === 'queue' && <QueueView tenantId={tenantId} />}
        {tab === 'book' && <BookView tenantId={tenantId} />}
        {me && tab === 'renew' && ((me.memberships?.length ?? 0) > 0
          ? <RenewView tenantId={tenantId} me={me} onDone={loadMe} />
          : <BuyMembershipView tenantId={tenantId} onDone={loadMe} />)}
        {me && tab === 'profile' && <ProfileView tenantId={tenantId} me={me} onSaved={loadMe} />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 grid grid-cols-5 border-t border-border bg-surface-raised">
        {mobileNav.map((n) => (
          <button key={n.key} onClick={() => setTab(n.key)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === n.key ? 'text-primary-600' : 'text-text-muted'}`}>
            <n.icon className="w-5 h-5" />{n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Brand({ companyName, logoUrl, compact }: { companyName: string; logoUrl: string | null; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center justify-center ${compact ? 'w-8 h-8' : 'w-9 h-9'} bg-primary-500 rounded-xl text-white font-bold overflow-hidden`}>
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="" className="w-full h-full object-contain" />
          : (companyName || 'A').charAt(0)}
      </span>
      <span className="font-semibold text-text-primary truncate">{companyName || 'Airin'}</span>
    </div>
  );
}

/** WhatsApp-OTP login. */
function PortalLogin({ tenantId, companyName, logoUrl, onAuthed }: { tenantId: string; companyName: string; logoUrl: string | null; onAuthed: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const request = async () => {
    if (!phone.trim()) return;
    setBusy(true); setErr(''); setInfo('');
    try {
      await portalApi(tenantId, '/portal/otp/request', { method: 'POST', auth: false, body: JSON.stringify({ tenantId, phone: phone.trim() }) });
      setStep('code');
      setInfo(t('portal.login.codeSent', 'We sent a code to your WhatsApp.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const verify = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await portalApi<{ token: string }>(tenantId, '/portal/otp/verify', { method: 'POST', auth: false, body: JSON.stringify({ tenantId, phone: phone.trim(), code: code.trim() }) });
      setPortalToken(tenantId, res.token);
      onAuthed();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <span className="inline-flex items-center justify-center w-14 h-14 bg-primary-500 rounded-2xl text-white text-2xl font-bold overflow-hidden mb-3">
            {logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logoUrl} alt="" className="w-full h-full object-contain" />
              : (companyName || 'A').charAt(0)}
          </span>
          <h1 className="text-xl font-bold text-text-primary">{companyName || t('portal.login.title', 'Member portal')}</h1>
          <p className="text-sm text-text-muted mt-1 text-center">{t('portal.login.subtitle', 'Sign in with your WhatsApp number to view your membership.')}</p>
        </div>
        <div className="card space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
          {info && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-800">{info}</div>}
          {step === 'phone' ? (
            <>
              <label className="block text-sm font-medium text-text-primary">{t('portal.login.phone', 'WhatsApp number')}</label>
              <input className="input-field" inputMode="tel" placeholder="08123456789" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') request(); }} />
              <button className="btn-primary w-full" onClick={request} disabled={busy || !phone.trim()}>{busy ? t('portal.login.sending', 'Sending…') : t('portal.login.sendCode', 'Send code')}</button>
            </>
          ) : (
            <>
              <label className="block text-sm font-medium text-text-primary">{t('portal.login.enterCode', 'Enter the 6-digit code')}</label>
              <input className="input-field text-center tracking-[0.5em] text-lg" inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') verify(); }} />
              <button className="btn-primary w-full" onClick={verify} disabled={busy || code.length < 4}>{busy ? t('portal.login.verifying', 'Verifying…') : t('portal.login.verify', 'Verify')}</button>
              <button className="btn-ghost w-full text-sm" onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>{t('portal.login.back', '← Change number')}</button>
            </>
          )}
        </div>
        <div className="flex justify-center mt-4"><LanguageToggle /></div>
      </div>
    </div>
  );
}

const MS_BADGE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700', grace: 'bg-amber-50 text-amber-700',
  revoked: 'bg-rose-50 text-rose-700', suspended: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-slate-100 text-slate-600', expired: 'bg-rose-50 text-rose-700',
};

function HomeView({ me, go }: { me: MemberResp; go: (tab: Tab) => void }) {
  const { t } = useI18n();
  const m = me.memberships?.[0];
  const onOpenCard = () => go('card');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t('portal.home.hello', 'Hi')}, {me.customer.name.split(' ')[0]}</h1>
        {me.customer.membershipNumber && <p className="text-xs text-text-muted font-mono mt-0.5">#{me.customer.membershipNumber}</p>}
      </div>
      {m ? (
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-muted">{t('portal.home.membership', 'Membership')}</p>
              <p className="text-lg font-semibold text-text-primary">{m.planName}</p>
            </div>
            <span className={`badge capitalize ${MS_BADGE[m.status] ?? 'bg-surface-sunken text-text-secondary'}`}>{m.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div><p className="text-xs text-text-muted">{t('portal.home.validUntil', 'Valid until')}</p><p className="font-medium">{m.endDate}</p></div>
            <div><p className="text-xs text-text-muted">{t('portal.home.usage', 'Usage')}</p><p className="font-medium">{m.usesCount}{m.maxUses ? ` / ${m.maxUses}` : ''}</p></div>
          </div>
          {(m.status === 'grace' || m.status === 'revoked') && (
            <div className={`mt-3 rounded-lg p-2.5 text-xs ${m.status === 'grace' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'}`}>
              {m.status === 'grace' ? t('portal.home.graceNote', 'Your membership has expired but can still be renewed during the grace period.') : t('portal.home.revokedNote', 'Your membership has expired. Please renew or ask staff about a new one.')}
              <button className="btn-primary w-full mt-2" onClick={() => go('renew')}>{t('portal.home.renewNow', 'Renew now')}</button>
            </div>
          )}
          {me.customer.membershipNumber && <button className="btn-secondary w-full mt-4" onClick={onOpenCard}>{t('portal.home.viewCard', 'View my card')}</button>}
        </div>
      ) : (
        <div className="card space-y-3">
          <p className="text-sm text-text-muted">{t('portal.home.noMembership', 'You have no active membership yet. Buy one online, or view the menu.')}</p>
          <button className="btn-primary w-full" onClick={() => go('renew')}>{t('portal.home.buyMembership', 'Buy a membership')}</button>
        </div>
      )}
      <button onClick={() => go('book')} className="btn-primary w-full flex items-center justify-center gap-2"><CalendarPlus className="w-4 h-4" />{t('portal.home.book', 'Book a wash')}</button>
      {/* Quick links (also in the desktop rail). */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => go('history')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <Receipt className="w-5 h-5 text-primary-600" />
          <div><p className="text-sm font-medium text-text-primary">{t('portal.nav.history', 'History')}</p></div>
        </button>
        <button onClick={() => go('vouchers')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <Ticket className="w-5 h-5 text-primary-600" />
          <div><p className="text-sm font-medium text-text-primary">{t('portal.nav.vouchers', 'Vouchers')}</p><p className="text-xs text-text-muted">{(me.vouchers ?? []).filter((v) => !v.isUsed).length} {t('portal.home.active', 'active')}</p></div>
        </button>
        <button onClick={() => go('vehicles')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <Car className="w-5 h-5 text-primary-600" />
          <div><p className="text-sm font-medium text-text-primary">{t('portal.nav.vehicles', 'Vehicles')}</p><p className="text-xs text-text-muted">{(me.customer.plates ?? []).length}</p></div>
        </button>
        <button onClick={() => go('profile')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <User className="w-5 h-5 text-primary-600" />
          <div><p className="text-sm font-medium text-text-primary">{t('portal.nav.profile', 'Profile')}</p></div>
        </button>
        {m && (
          <button onClick={() => go('renew')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
            <RefreshCw className="w-5 h-5 text-primary-600" />
            <div><p className="text-sm font-medium text-text-primary">{t('portal.nav.renew', 'Renew')}</p></div>
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryView({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [orders, setOrders] = useState<PortalOrder[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    portalApi<PortalOrder[]>(tenantId, '/portal/orders').then(setOrders).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [tenantId]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.history.title', 'Visit history')}</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!orders ? <p className="text-sm text-text-muted">{t('portal.loading', 'Loading…')}</p> : orders.length === 0 ? (
        <p className="text-sm text-text-muted">{t('portal.history.none', 'No visits yet.')}</p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.orderNumber} className="card">
              <div className="flex items-center justify-between">
                <p className="font-medium text-text-primary text-sm">{o.services || o.orderNumber}</p>
                <span className="font-semibold text-primary-600">{fmt(o.total)}</span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-text-muted">
                <span>{new Date(o.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className={`badge capitalize ${o.status === 'paid' || o.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : o.status === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-surface-sunken text-text-secondary'}`}>{o.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueView({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [outletId, setOutletId] = useState('');
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);

  useEffect(() => {
    portalApi<Branch[]>(tenantId, '/portal/branches').then((b) => { setBranches(b); if (b[0]) setOutletId(b[0].id); }).catch(() => {});
  }, [tenantId]);
  useEffect(() => {
    if (!outletId) return;
    let alive = true;
    const load = () => portalApi<QueueEntry[]>(tenantId, `/portal/queue?outletId=${outletId}`).then((q) => { if (alive) setQueue(q); }).catch(() => {});
    load();
    const poll = setInterval(load, 15000); // live-ish
    return () => { alive = false; clearInterval(poll); };
  }, [tenantId, outletId]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.queue.title', 'Live queue')}</h1>
      <select aria-label={t('portal.queue.branch', 'Branch')} className="input-field" value={outletId} onChange={(e) => { setOutletId(e.target.value); setQueue(null); }}>
        {branches.length === 0 && <option value="">—</option>}
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {!queue ? <p className="text-sm text-text-muted">{t('portal.loading', 'Loading…')}</p> : queue.length === 0 ? (
        <p className="text-sm text-text-muted">{t('portal.queue.empty', 'No cars in the queue right now.')}</p>
      ) : (
        <div className="space-y-2">
          {queue.map((q, i) => (
            <div key={i} className={`card flex items-center gap-4 ${q.mine ? 'border-primary-400 ring-1 ring-primary-100' : ''}`}>
              <div className="text-2xl font-bold w-8 text-center text-primary-600">{q.position || i + 1}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary">{q.plate || '—'}{q.mine && <span className="ml-2 badge bg-primary-50 text-primary-700">{t('portal.queue.you', 'You')}</span>}</p>
                <p className="text-xs text-text-muted">{q.vehicle || ''}</p>
              </div>
              <span className={`badge capitalize ${q.status === 'serving' ? 'bg-sky-50 text-sky-700' : 'bg-surface-sunken text-text-secondary'}`}>{q.status === 'serving' ? t('portal.queue.serving', 'In service') : t('portal.queue.waiting', 'Waiting')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CardView({ me, tenantId }: { me: MemberResp; tenantId: string }) {
  const { t } = useI18n();
  const [tpl, setTpl] = useState<CardTemplate | null>(null);
  useEffect(() => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/public/card-template?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && Array.isArray(c.elements)) setTpl(c); }).catch(() => {});
  }, [tenantId]);
  const m = me.memberships?.[0];
  if (!me.customer.membershipNumber) return <p className="text-sm text-text-muted">{t('portal.card.none', 'No membership card yet.')}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.card.title', 'Membership card')}</h1>
      <div className="flex justify-center">
        {tpl
          ? <MembershipCard template={tpl} data={{ name: me.customer.name, number: me.customer.membershipNumber, validUntil: mmYY(m?.endDate) }} scale={0.65} />
          : <p className="text-sm text-text-muted">{t('portal.loading', 'Loading…')}</p>}
      </div>
      <p className="text-center text-xs text-text-muted font-mono">{me.customer.membershipNumber}</p>
    </div>
  );
}

function VouchersView({ me }: { me: MemberResp }) {
  const { t } = useI18n();
  const vouchers = me.vouchers ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.nav.vouchers', 'Vouchers')}</h1>
      {vouchers.length === 0 ? <p className="text-sm text-text-muted">{t('portal.vouchers.none', 'No vouchers yet.')}</p> : (
        <div className="space-y-2">
          {vouchers.map((v) => (
            <div key={v.id} className={`card flex items-center justify-between ${v.isUsed ? 'opacity-60' : ''}`}>
              <div>
                <p className="font-mono font-semibold text-text-primary">{v.code}</p>
                <p className="text-xs text-text-muted">{v.type === 'percentage' ? `${v.value}%` : v.type === 'fixed' ? fmt(v.value) : t('portal.vouchers.service', 'Free service')}{v.expiresAt ? ` · ${t('portal.vouchers.exp', 'exp')} ${new Date(v.expiresAt).toLocaleDateString('id-ID')}` : ''}</p>
              </div>
              <span className={`badge ${v.isUsed ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{v.isUsed ? t('portal.vouchers.used', 'Used') : t('portal.vouchers.active', 'Active')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehiclesView({ me, tenantId, onChanged }: { me: MemberResp; tenantId: string; onChanged: () => void }) {
  const { t } = useI18n();
  const plates = me.customer.plates ?? [];
  const hasMembership = (me.memberships?.length ?? 0) > 0;
  const [form, setForm] = useState({ plate: '', brand: '', model: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const add = async () => {
    if (!form.plate.trim()) { setErr(t('portal.vehicles.needPlate', 'Enter a plate number.')); return; }
    setBusy(true); setErr('');
    try {
      await portalApi(tenantId, '/portal/vehicles', { method: 'POST', body: JSON.stringify({ plate: form.plate.trim(), brand: form.brand.trim() || undefined, model: form.model.trim() || undefined }) });
      setForm({ plate: '', brand: '', model: '' });
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const remove = async (plate: string) => {
    if (!window.confirm(t('portal.vehicles.confirmDelete', 'Remove this vehicle?'))) return;
    setErr('');
    try { await portalApi(tenantId, `/portal/vehicles/${encodeURIComponent(plate)}`, { method: 'DELETE' }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.nav.vehicles', 'Vehicles')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {plates.length === 0 ? <p className="text-sm text-text-muted">{t('portal.vehicles.none', 'No registered vehicles.')}</p> : (
        <div className="space-y-2">
          {plates.map((p) => (
            <div key={p.plate} className="card flex items-center gap-3">
              <Car className="w-5 h-5 text-primary-600" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary">{p.plate}</p>
                <p className="text-xs text-text-muted">{[p.brand, p.model].filter(Boolean).join(' ') || '—'}</p>
              </div>
              <button onClick={() => remove(p.plate)} className="text-xs text-red-600 hover:underline">{t('portal.vehicles.remove', 'Remove')}</button>
            </div>
          ))}
        </div>
      )}
      {hasMembership ? (
        <div className="card space-y-3">
          <p className="section-title">{t('portal.vehicles.add', 'Add a vehicle')}</p>
          <input className="input-field" placeholder={t('portal.vehicles.plate', 'License plate')} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input-field" placeholder={t('portal.vehicles.brand', 'Brand (optional)')} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            <input className="input-field" placeholder={t('portal.vehicles.model', 'Model (optional)')} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <button className="btn-primary w-full" onClick={add} disabled={busy || !form.plate.trim()}>{busy ? t('portal.vehicles.adding', 'Adding…') : t('portal.vehicles.addBtn', 'Add vehicle')}</button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">{t('portal.vehicles.needMembership', 'You need an active membership to register vehicles.')}</p>
      )}
    </div>
  );
}

function MenuView({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  useEffect(() => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/kiosk/menu?tenantId=${encodeURIComponent(tenantId)}`).then((r) => (r.ok ? r.json() : null)).then(setMenu).catch(() => {});
  }, [tenantId]);
  if (!menu) return <p className="text-sm text-text-muted">{t('portal.loading', 'Loading…')}</p>;
  const allItems = [...menu.services, ...(menu.products ?? [])];
  const units = Array.from(new Set(allItems.map((s) => s.businessUnit)));
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.menu.title', 'Services & prices')}</h1>
      {units.map((u) => (
        <section key={u}>
          <h2 className="text-sm font-semibold text-text-secondary mb-2 pb-1 border-b border-border">{u === 'LEAD' ? 'LEAD · Detailing' : 'AIRE · Car Wash'}</h2>
          <div className="divide-y divide-border">
            {allItems.filter((s) => s.businessUnit === u).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-text-primary">{s.name}</span>
                <span className="font-semibold text-primary-600">{fmt(s.price)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {menu.plans?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-2 pb-1 border-b border-border">{t('portal.menu.membership', 'Membership')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {menu.plans.map((p, i) => (
              <div key={i} className="card"><p className="font-semibold text-text-primary text-sm">{p.name}</p><p className="text-primary-600 font-bold mt-0.5">{fmt(p.price)}</p><p className="text-xs text-text-muted">{p.durationMonths} {t('portal.menu.months', 'mo')}</p></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RenewView({ tenantId, me, onDone }: { tenantId: string; me: MemberResp; onDone: () => void }) {
  const { t } = useI18n();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const membership = me.memberships?.[0];

  useEffect(() => {
    portalApi<Plan[]>(tenantId, '/portal/plans').then((p) => { setPlans(p); if (p[0]) setPlanId(p[0].id); }).catch(() => {});
  }, [tenantId]);

  // Poll for payment once a charge is shown.
  useEffect(() => {
    if (!orderId || done) return;
    const id = setInterval(async () => {
      try {
        const s = await portalApi<{ status: string; applied: boolean }>(tenantId, `/portal/renew/status?orderId=${orderId}`);
        if (s.applied || ['paid', 'confirmed', 'completed'].includes(s.status)) { clearInterval(id); setDone(true); onDone(); }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [orderId, done, tenantId, onDone]);

  const start = async () => {
    if (!membership || !planId) return;
    setBusy(true); setErr('');
    try {
      const res = await portalApi<{ orderId: string; qrString: string }>(tenantId, '/portal/renew', { method: 'POST', body: JSON.stringify({ membershipId: membership.id, planId }) });
      setOrderId(res.orderId); setQr(res.qrString);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  if (done) return (
    <div className="text-center space-y-3 py-10">
      <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-2xl">✓</div>
      <h1 className="text-xl font-bold text-text-primary">{t('portal.renew.done', 'Membership renewed!')}</h1>
      <p className="text-sm text-text-muted">{t('portal.renew.doneNote', 'Your membership has been extended. Thank you!')}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.renew.title', 'Renew membership')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {!membership ? <p className="text-sm text-text-muted">{t('portal.renew.noMembership', 'No membership to renew.')}</p> : qr ? (
        <div className="card text-center space-y-3">
          <p className="text-sm text-text-secondary">{t('portal.renew.scan', 'Scan with any QRIS app to pay')}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`} alt="QRIS" width={220} height={220} className="mx-auto rounded-lg border border-border" />
          <p className="text-sm text-text-secondary flex items-center justify-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />{t('portal.renew.waiting', 'Waiting for payment…')}</p>
        </div>
      ) : (
        <div className="card space-y-3">
          <div><p className="text-xs text-text-muted">{t('portal.renew.current', 'Current plan')}</p><p className="font-medium">{membership.planName} · <span className="capitalize">{membership.status}</span></p></div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.renew.pickPlan', 'Choose a plan')}</label>
            <select aria-label={t('portal.renew.pickPlan', 'Choose a plan')} className="input-field" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)} ({p.durationMonths} {t('portal.menu.months', 'mo')})</option>)}
            </select>
          </div>
          <button className="btn-primary w-full" onClick={start} disabled={busy || !planId}>{busy ? t('portal.renew.starting', 'Starting…') : t('portal.renew.payQris', 'Renew & pay (QRIS)')}</button>
        </div>
      )}
    </div>
  );
}

function BuyMembershipView({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [plates, setPlates] = useState<{ plate: string; brand: string; model: string }[]>([{ plate: '', brand: '', model: '' }]);
  const [buy, setBuy] = useState<{ orderId: string; membershipId: string; qrString: string } | null>(null);
  const [paid, setPaid] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    portalApi<Plan[]>(tenantId, '/portal/plans').then((p) => { setPlans(p); if (p[0]) setPlanId(p[0].id); }).catch(() => {});
  }, [tenantId]);

  // Poll the purchase order; once paid, activate with the entered plates.
  useEffect(() => {
    if (!buy || done) return;
    const id = setInterval(async () => {
      try {
        const s = await portalApi<{ status: string; paid: boolean }>(tenantId, `/portal/membership/buy/status?orderId=${buy.orderId}`);
        if (s.paid) {
          clearInterval(id);
          setPaid(true);
          const valid = plates.filter((p) => p.plate.trim()).map((p) => ({ plate: p.plate.trim(), brand: p.brand.trim() || undefined, model: p.model.trim() || undefined }));
          await portalApi(tenantId, '/portal/membership/activate', { method: 'POST', body: JSON.stringify({ membershipId: buy.membershipId, plates: valid }) });
          setDone(true); onDone();
        }
      } catch { /* keep polling / retry activate next tick */ }
    }, 3000);
    return () => clearInterval(id);
  }, [buy, done, plates, tenantId, onDone]);

  const start = async () => {
    if (!planId) return;
    if (!plates.some((p) => p.plate.trim())) { setErr(t('portal.buy.needPlate', 'Enter at least one vehicle plate.')); return; }
    setBusy(true); setErr('');
    try {
      const res = await portalApi<{ orderId: string; membershipId: string; qrString: string }>(tenantId, '/portal/membership/buy', { method: 'POST', body: JSON.stringify({ planId }) });
      setBuy({ orderId: res.orderId, membershipId: res.membershipId, qrString: res.qrString });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  if (done) return (
    <div className="text-center space-y-3 py-10">
      <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-2xl">✓</div>
      <h1 className="text-xl font-bold text-text-primary">{t('portal.buy.done', 'Membership activated!')}</h1>
      <p className="text-sm text-text-muted">{t('portal.buy.doneNote', 'Welcome aboard. Your membership is now active.')}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.buy.title', 'Buy a membership')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {buy ? (
        <div className="card text-center space-y-3">
          <p className="text-sm text-text-secondary">{paid ? t('portal.buy.activating', 'Payment received — activating…') : t('portal.renew.scan', 'Scan with any QRIS app to pay')}</p>
          {!paid && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(buy.qrString)}`} alt="QRIS" width={220} height={220} className="mx-auto rounded-lg border border-border" />
          )}
          <p className="text-sm text-text-secondary flex items-center justify-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />{paid ? t('portal.buy.finishing', 'Finishing up…') : t('portal.renew.waiting', 'Waiting for payment…')}</p>
        </div>
      ) : (
        <div className="card space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.renew.pickPlan', 'Choose a plan')}</label>
            <select aria-label={t('portal.renew.pickPlan', 'Choose a plan')} className="input-field" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)} ({p.durationMonths} {t('portal.menu.months', 'mo')})</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-primary">{t('portal.buy.vehicles', 'Your vehicle(s)')}</label>
            {plates.map((pl, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <input className="input-field" placeholder={t('portal.vehicles.plate', 'License plate')} value={pl.plate} onChange={(e) => setPlates(plates.map((x, j) => j === i ? { ...x, plate: e.target.value } : x))} />
                <input className="input-field" placeholder={t('portal.vehicles.brand', 'Brand')} value={pl.brand} onChange={(e) => setPlates(plates.map((x, j) => j === i ? { ...x, brand: e.target.value } : x))} />
                <input className="input-field" placeholder={t('portal.vehicles.model', 'Model')} value={pl.model} onChange={(e) => setPlates(plates.map((x, j) => j === i ? { ...x, model: e.target.value } : x))} />
              </div>
            ))}
            <button type="button" className="btn-ghost text-xs" onClick={() => setPlates([...plates, { plate: '', brand: '', model: '' }])}>+ {t('portal.buy.addVehicle', 'Add another vehicle')}</button>
          </div>
          <button className="btn-primary w-full" onClick={start} disabled={busy || !planId}>{busy ? t('portal.buy.starting', 'Starting…') : t('portal.buy.pay', 'Buy & pay (QRIS)')}</button>
        </div>
      )}
    </div>
  );
}

function ProfileView({ tenantId, me, onSaved }: { tenantId: string; me: MemberResp; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(me.customer.name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) { setErr(t('portal.profile.needName', 'Name cannot be empty.')); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await portalApi(tenantId, '/portal/me', { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      setMsg(t('portal.profile.saved', 'Profile updated.'));
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.profile.title', 'My profile')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-800">{msg}</div>}
      <div className="card space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.profile.name', 'Name')}</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.profile.phone', 'WhatsApp number')}</label>
          <input className="input-field bg-surface-sunken" value={me.customer.phone} readOnly />
          <p className="text-xs text-text-muted mt-1">{t('portal.profile.phoneNote', 'Your number is your sign-in and cannot be changed here.')}</p>
        </div>
        {me.customer.membershipNumber && (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.profile.member', 'Membership number')}</label>
            <input className="input-field bg-surface-sunken font-mono" value={me.customer.membershipNumber} readOnly />
          </div>
        )}
        <button className="btn-primary w-full" onClick={save} disabled={busy || name.trim() === me.customer.name}>{busy ? t('portal.profile.saving', 'Saving…') : t('portal.profile.save', 'Save changes')}</button>
      </div>
    </div>
  );
}

function BookView({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<MenuService[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [form, setForm] = useState({ outletId: '', serviceId: '', scheduledAt: '', plate: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const loadBookings = useCallback(() => { portalApi<Booking[]>(tenantId, '/portal/bookings').then(setBookings).catch(() => {}); }, [tenantId]);
  useEffect(() => {
    portalApi<Branch[]>(tenantId, '/portal/branches').then((b) => { setBranches(b); if (b[0]) setForm((f) => ({ ...f, outletId: b[0]!.id })); }).catch(() => {});
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/kiosk/menu?tenantId=${encodeURIComponent(tenantId)}`).then((r) => (r.ok ? r.json() : null)).then((m) => setServices(m?.services ?? [])).catch(() => {});
    loadBookings();
  }, [tenantId, loadBookings]);

  const submit = async () => {
    if (!form.outletId || !form.scheduledAt) { setErr(t('portal.book.needFields', 'Choose a branch and a date/time.')); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await portalApi(tenantId, '/portal/bookings', { method: 'POST', body: JSON.stringify(form) });
      setMsg(t('portal.book.submitted', 'Booking requested! You’ll get a WhatsApp once the branch confirms.'));
      setForm((f) => ({ ...f, serviceId: '', scheduledAt: '', plate: '' }));
      loadBookings();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  const BADGE: Record<string, string> = { pending: 'bg-amber-50 text-amber-700', confirmed: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700' };
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-text-primary">{t('portal.book.title', 'Book a wash')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-800">{msg}</div>}
      <div className="card space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.book.branch', 'Branch')}</label>
          <select aria-label={t('portal.book.branch', 'Branch')} className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.book.service', 'Service')}</label>
          <select aria-label={t('portal.book.service', 'Service')} className="input-field" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            <option value="">{t('portal.book.anyService', '— any —')}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmt(s.price)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('portal.book.when', 'Date & time')}</label>
          <input aria-label={t('portal.book.when', 'Date & time')} type="datetime-local" className="input-field" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </div>
        <input className="input-field" placeholder={t('portal.book.plate', 'License plate (optional)')} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
        <button className="btn-primary w-full" onClick={submit} disabled={busy}>{busy ? t('portal.book.submitting', 'Submitting…') : t('portal.book.submit', 'Request booking')}</button>
        <p className="text-xs text-text-muted">{t('portal.book.note', 'The branch confirms your booking on WhatsApp before your car joins the queue.')}</p>
      </div>
      {bookings.length > 0 && (
        <div>
          <h2 className="section-title mb-2">{t('portal.book.mine', 'My bookings')}</h2>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-text-primary text-sm">{b.serviceName || t('portal.book.wash', 'Wash')}{b.plate ? ` · ${b.plate}` : ''}</p>
                  <p className="text-xs text-text-muted">{new Date(b.scheduledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}{b.outletName ? ` · ${b.outletName}` : ''}</p>
                </div>
                <span className={`badge capitalize ${BADGE[b.status] ?? 'bg-surface-sunken text-text-secondary'}`}>{b.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
