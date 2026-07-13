'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  ServiceModal,
  RecipeModal,
  CATEGORY_LABELS,
  CATEGORY_KEYS,
  type ServiceDTO,
  type Category,
  type Brand,
} from './service-forms';

export default function ServicesPage() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [recipeFor, setRecipeFor] = useState<ServiceDTO | null>(null);

  const brandById = useCallback((id: string | null) => id ? brands.find((b) => b.id === id) ?? null : null, [brands]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, cats, brs] = await Promise.all([
        api.get<ServiceDTO[]>('/services'),
        api.get<Category[]>('/categories').catch(() => [] as Category[]),
        api.get<Brand[]>('/brands').catch(() => [] as Brand[]),
      ]);
      // Products live in the same store but are managed on the Products page.
      setServices(data.filter((s) => s.category !== 'product'));
      setCategories(cats);
      setBrands(brs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.loadFailed', 'Failed to load services'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm(t('dash.services.confirmDelete', 'Delete this service?'))) return;
    try {
      await api.delete(`/services/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.deleteFailed', 'Delete failed'));
    }
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (s: ServiceDTO) => { setEditing(s); setModalOpen(true); };

  return (
    <div data-testid="services-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="services-title">{t('dash.services.title', 'Services')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.services.subtitle', 'Manage your service menu and pricing. Active services appear on the POS menu.')}</p>
        </div>
        <button className="btn-primary" data-testid="add-service-btn" onClick={openAdd}>{t('dash.services.addBtn', '+ Add Service')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.services.loadingServices', 'Loading services…')}</div>
      ) : services.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.services.empty', 'No services yet. Click "Add Service" to create one.')}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full" data-testid="services-table">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.name', 'Name')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.unit', 'Unit')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.category', 'Category')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.priceCol', 'Price')}</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.status', 'Status')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`service-row-${s.id}`}>
                  <td className="px-5 py-3.5">
                    <div className="text-sm font-medium text-text-primary">{s.name}</div>
                    {(() => { const b = brandById(s.brandId); return b ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-muted">
                        <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                        {b.code} · {b.name}
                      </span>
                    ) : null; })()}
                  </td>
                  <td className="px-5 py-3.5"><span className={`badge ${s.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{s.businessUnit ?? 'AIRE'}</span></td>
                  <td className="px-5 py-3.5"><span className="badge bg-primary-50 text-primary-700">{t(CATEGORY_KEYS[s.category], CATEGORY_LABELS[s.category])}</span></td>
                  <td className="px-5 py-3.5 text-sm text-text-primary text-right font-mono">Rp {s.price.toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`badge ${s.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? t('dash.services.active', 'Active') : t('dash.services.inactive', 'Inactive')}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setRecipeFor(s)}>{t('dash.services.recipe', 'Recipe')}</button>
                    <button className="btn-ghost text-xs" onClick={() => openEdit(s)}>{t('dash.services.edit', 'Edit')}</button>
                    <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(s.id)}>{t('dash.services.delete', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ServiceModal
          initial={editing}
          categories={categories}
          brands={brands}
          categoryOptions={['car_wash', 'add_on']}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}

      {recipeFor && <RecipeModal service={recipeFor} onClose={() => setRecipeFor(null)} />}
    </div>
  );
}
