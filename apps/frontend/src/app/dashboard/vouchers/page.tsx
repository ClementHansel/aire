'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Branch { id: string; name: string }
interface ServiceLite { id: string; name: string }
interface Book { id: string; buyerName: string | null; buyerPhone: string | null; quantity: number; benefitType: string; unitPrice: number; outletName: string; redeemed: number; createdAt: string }
interface Ticket { id: string; code: string; status: string; expiryDate: string | null; redeemedAt: string | null }

function SellModal({ branches, services, onClose, onSold }: { branches: Branch[]; services: ServiceLite[]; onClose: () => void; onSold: (codes: string[]) => void }) {
  const [outletId, setOutletId] = useState(branches[0]?.id ?? '');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [benefitType, setBenefitType] = useState('service');
  const [benefitServiceId, setBenefitServiceId] = useState('');
  const [benefitValue, setBenefitValue] = useState('0');
  const [unitPrice, setUnitPrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await api.post<{ codes: string[] }>('/voucher-tickets/sell', {
        outletId, buyerName: buyerName || undefined, buyerPhone: buyerPhone || undefined,
        quantity: Number(quantity), benefitType,
        benefitServiceId: benefitServiceId || null, benefitValue: Number(benefitValue) || 0,
        unitPrice: Number(unitPrice) || 0, expiryDate: expiryDate || null,
      });
      onSold(res.codes);
    } catch (err) { setError(err instanceof Error ? err.message : 'Sale failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">Sell Voucher Pack</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">Branch (voucher code prefix)</label>
            <select className="input-field" value={outletId} onChange={(e) => setOutletId(e.target.value)} required>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Buyer name</label><input className="input-field" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></div>
            <div><label className="block text-sm font-medium mb-1.5">WhatsApp number</label><input className="input-field" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="08123…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Quantity</label><input type="number" min="1" max="1000" className="input-field" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">Price each (Rp)</label><input type="number" className="input-field" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Each voucher gives</label>
            <select className="input-field" value={benefitType} onChange={(e) => setBenefitType(e.target.value)}>
              <option value="service">A free service</option>
              <option value="fixed">Fixed discount (Rp)</option>
              <option value="percentage">Percentage discount (%)</option>
            </select>
          </div>
          {benefitType === 'service' ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">Free service</label>
              <select className="input-field" value={benefitServiceId} onChange={(e) => setBenefitServiceId(e.target.value)}>
                <option value="">— select —</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ) : (
            <div><label className="block text-sm font-medium mb-1.5">Value</label><input type="number" className="input-field" value={benefitValue} onChange={(e) => setBenefitValue(e.target.value)} /></div>
          )}
          <div><label className="block text-sm font-medium mb-1.5">Expiry date (optional)</label><input type="date" className="input-field" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Issuing…' : 'Sell & Issue'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VouchersPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [error, setError] = useState('');
  const [sellOpen, setSellOpen] = useState(false);
  const [issued, setIssued] = useState<string[] | null>(null);
  const [tickets, setTickets] = useState<{ bookId: string; rows: Ticket[] } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [bk, br, sv] = await Promise.all([api.get<Book[]>('/voucher-tickets/books'), api.get<Branch[]>('/outlets'), api.get<ServiceLite[]>('/services')]);
      setBooks(bk); setBranches(br); setServices(sv);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const viewTickets = async (bookId: string) => {
    try { setTickets({ bookId, rows: await api.get<Ticket[]>(`/voucher-tickets/books/${bookId}/tickets`) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };

  return (
    <div data-testid="vouchers-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Digital Vouchers</h1>
          <p className="mt-1 text-sm text-text-secondary">Sell shareable voucher packs (code format BRANCH-MMYYYY-NNNNNN), delivered to the buyer&apos;s WhatsApp.</p>
        </div>
        <button className="btn-primary" onClick={() => setSellOpen(true)}>+ Sell Pack</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Buyer</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Branch</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Qty</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Redeemed</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Date</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Codes</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {books.length === 0 ? <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">No voucher packs sold yet.</td></tr> : books.map((b) => (
              <tr key={b.id}>
                <td className="px-5 py-3.5 text-sm font-medium">{b.buyerName ?? '—'}<div className="text-xs text-text-muted">{b.buyerPhone}</div></td>
                <td className="px-5 py-3.5 text-sm">{b.outletName}</td>
                <td className="px-5 py-3.5 text-sm text-right">{b.quantity}</td>
                <td className="px-5 py-3.5 text-sm text-right">{b.redeemed}/{b.quantity}</td>
                <td className="px-5 py-3.5 text-xs text-text-muted">{new Date(b.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3.5 text-right"><button className="btn-ghost text-xs" onClick={() => viewTickets(b.id)}>View codes</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sellOpen && <SellModal branches={branches} services={services} onClose={() => setSellOpen(false)} onSold={(codes) => { setSellOpen(false); setIssued(codes); load(); }} />}

      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIssued(null)}>
          <div className="card w-full max-w-md text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
            <h3 className="text-lg font-semibold text-text-primary">{issued.length} vouchers issued</h3>
            <p className="text-sm text-text-secondary mt-1">Sent to the buyer&apos;s WhatsApp (if a number was given).</p>
            <div className="mt-4 max-h-48 overflow-auto text-left bg-surface-sunken rounded-lg p-3 font-mono text-xs space-y-1">
              {issued.map((c) => <div key={c}>{c}</div>)}
            </div>
            <button className="btn-primary w-full mt-4" onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      )}

      {tickets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTickets(null)}>
          <div className="card w-full max-w-md max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-3">Voucher codes</h3>
            <div className="space-y-1.5">
              {tickets.rows.map((t) => (
                <div key={t.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm">
                  <span className="font-mono">{t.code}</span>
                  <span className={`badge ${t.status === 'redeemed' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'}`}>{t.status}</span>
                </div>
              ))}
            </div>
            <button className="btn-secondary w-full mt-4" onClick={() => setTickets(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
