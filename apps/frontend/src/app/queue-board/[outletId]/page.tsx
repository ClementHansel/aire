'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';
import { AirinLogo } from '@/components/shared/AirinLogo';

interface OrderCard {
  id: string;
  orderNumber: string;
  customerName: string;
  licensePlate?: string;
  status: string;
  createdAt: string;
}
interface OrderListResponse { orders: OrderCard[] }
interface BayDTO { id: string; name: string; status: string }

const AVG_MINUTES = 15;

export default function QueueBoardPage() {
  const { t } = useI18n();
  const tenantBrand = usePublicBranding(getUser()?.tenantId);
  const [queue, setQueue] = useState<OrderCard[]>([]);
  const [bays, setBays] = useState<BayDTO[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [paid, confirmed, bayList] = await Promise.all([
        api.get<OrderListResponse>('/orders?status=paid'),
        api.get<OrderListResponse>('/orders?status=confirmed'),
        api.get<BayDTO[]>('/bays').catch(() => [] as BayDTO[]),
      ]);
      const merged = [...paid.orders, ...confirmed.orders].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setQueue(merged);
      setBays(bayList);
    } catch {
      // keep last good state
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    setReady(true);
    load();
    const poll = setInterval(load, 10000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (!ready) return null;

  const activeBays = bays.filter((b) => b.status === 'occupied').length || 1;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          {tenantBrand.logoUrl ? (
            <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tenantBrand.logoUrl} alt="" className="w-full h-full object-contain" />
            </div>
          ) : (
            <AirinLogo showWordmark={false} tone="onDark" />
          )}
          <div>
            {tenantBrand.companyName && <p className="text-sm text-slate-400 leading-tight">{tenantBrand.companyName}</p>}
            <h1 className="text-3xl font-bold leading-tight">{t('cust.queueBoard.title', 'Service Queue')}</h1>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono">{now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="text-sm text-slate-400">{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      {/* Bays */}
      {bays.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
          {bays.map((b) => (
            <div key={b.id} className={`rounded-xl p-4 text-center ${b.status === 'occupied' ? 'bg-primary-600' : b.status === 'maintenance' ? 'bg-slate-700' : 'bg-green-600'}`}>
              <p className="font-semibold">{b.name}</p>
              <p className="text-xs capitalize opacity-80">{b.status}</p>
            </div>
          ))}
        </div>
      )}

      {/* Queue */}
      {queue.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-2xl text-slate-500">{t('cust.queueBoard.empty', 'No vehicles in queue')}</div>
      ) : (
        <div className="grid gap-3">
          {queue.map((o, idx) => (
            <div key={o.id} className={`flex items-center gap-5 rounded-2xl p-5 ${idx === 0 ? 'bg-primary-500' : 'bg-slate-800'}`}>
              <div className="text-5xl font-bold w-20 text-center">{idx + 1}</div>
              <div className="flex-1">
                <p className="text-2xl font-semibold">{o.orderNumber}</p>
                <p className="text-slate-300">{o.customerName}{o.licensePlate ? ` · ${o.licensePlate}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-400">{t('cust.queueBoard.estWait', 'Est. wait')}</p>
                <p className="text-2xl font-mono">{Math.ceil((idx / activeBays) * AVG_MINUTES)} {t('cust.queueBoard.min', 'min')}</p>
              </div>
              {idx === 0 && <span className="text-sm font-semibold bg-white/20 rounded-md px-4 py-1.5">{t('cust.queueBoard.next', 'NEXT')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
