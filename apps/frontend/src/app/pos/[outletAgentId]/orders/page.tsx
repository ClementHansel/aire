'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface OrderCardItem { serviceName: string; quantity: number; subtotal: number }
interface OrderCard {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  licensePlate?: string;
  operatorName: string;
  status: 'ordered' | 'paid' | 'confirmed' | 'completed' | 'cancelled';
  items: OrderCardItem[];
  total: number;
  createdAt: string;
}
interface OrderListResponse { orders: OrderCard[]; total: number; page: number; pageSize: number; hasMore: boolean }

const STATUS_BADGE: Record<string, string> = {
  ordered: 'bg-amber-50 text-amber-700',
  paid: 'bg-green-50 text-green-700',
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-700',
};

const STATUSES = ['all', 'ordered', 'paid', 'confirmed', 'completed', 'cancelled'];

export default function OrdersPage() {
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (status !== 'all') qs.set('status', status);
      if (search.trim()) qs.set('search', search.trim());
      const data = await api.get<OrderListResponse>(`/orders?${qs.toString()}`);
      setOrders(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally { setLoading(false); }
  }, [status, search]);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const user = getUser();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center"><span className="text-sm font-bold text-white">A</span></div>
            <p className="font-semibold text-text-primary text-sm">Orders</p>
          </div>
          <nav className="flex gap-1 text-sm">
            <Link href={`/pos/${agent}/new-order`} className="btn-ghost py-1.5 px-3">New Order</Link>
            <span className="btn-ghost py-1.5 px-3 bg-surface-sunken">Orders</span>
            <Link href={`/pos/${agent}/summary`} className="btn-ghost py-1.5 px-3">Summary</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{user?.name}</span>
          <button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary">Sign out</button>
        </div>
      </header>

      <div className="p-5 flex-1">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input className="input-field max-w-xs" placeholder="Search order # / name / phone…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <select className="input-field max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
          <button className="btn-secondary" onClick={load}>Refresh</button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

        {loading ? (
          <div className="card text-sm text-text-muted">Loading orders…</div>
        ) : orders.length === 0 ? (
          <div className="card text-sm text-text-muted">No orders found.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => (
              <div key={o.id} className="card" data-testid={`order-card-${o.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-text-primary">{o.orderNumber}</span>
                  <span className={`badge ${STATUS_BADGE[o.status]} capitalize`}>{o.status}</span>
                </div>
                <p className="text-sm text-text-primary">{o.customerName}</p>
                <p className="text-xs text-text-muted">{o.customerPhone}{o.licensePlate ? ` · ${o.licensePlate}` : ''}</p>
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex justify-between text-xs text-text-secondary">
                      <span>{it.quantity}× {it.serviceName}</span>
                      <span>{fmt(it.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-border">
                  <span className="text-xs text-text-muted">{new Date(o.createdAt).toLocaleString('id-ID')}</span>
                  <span className="font-semibold text-primary-600">{fmt(o.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
