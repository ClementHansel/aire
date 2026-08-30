'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { BusinessUnitsPanel } from '@/components/dashboard/BusinessUnitsPanel';

type AppliesTo = 'service' | 'product' | 'both';
interface Category { id: string; name: string; sortOrder: number; isActive: boolean; appliesTo: AppliesTo }
interface Brand { id: string; code: string; name: string; color: string; isActive: boolean; appliesTo: AppliesTo }

export default function CatalogPage() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState('');
  const [catName, setCatName] = useState('');
  const [catAppliesTo, setCatAppliesTo] = useState<AppliesTo>('both');
  const [brandCode, setBrandCode] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('#1652F0');
  const [brandAppliesTo, setBrandAppliesTo] = useState<AppliesTo>('both');

  // Inline edit state
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatAppliesTo, setEditCatAppliesTo] = useState<AppliesTo>('both');
  const [editBrandId, setEditBrandId] = useState<string | null>(null);
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandColor, setEditBrandColor] = useState('#1652F0');
  const [editBrandAppliesTo, setEditBrandAppliesTo] = useState<AppliesTo>('both');

  const appliesToLabel = (a: AppliesTo) =>
    a === 'service' ? t('dash.catalog.forServices', 'Services')
      : a === 'product' ? t('dash.catalog.forProducts', 'Products')
      : t('dash.catalog.forBoth', 'Both');

  const SECTIONS: AppliesTo[] = ['service', 'product', 'both'];

  const msg = (err: unknown) => {
    const m = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(m)) return t('dash.catalog.duplicate', 'That name/code already exists.');
    return m || t('dash.catalog.failed', 'Failed');
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, b] = await Promise.all([api.get<Category[]>('/categories'), api.get<Brand[]>('/brands')]);
      setCategories(c); setBrands(b);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.catalog.loadFailed', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // ── Categories ──────────────────────────────────────────────────────────────
  const addCategory = async () => {
    if (!catName.trim()) return;
    try { await api.post('/categories', { name: catName.trim(), appliesTo: catAppliesTo }); setCatName(''); setCatAppliesTo('both'); await load(); }
    catch (err) { setError(msg(err)); }
  };
  const saveCategory = async (id: string) => {
    if (!editCatName.trim()) return;
    try { await api.put(`/categories/${id}`, { name: editCatName.trim(), appliesTo: editCatAppliesTo }); setEditCatId(null); await load(); }
    catch (err) { setError(msg(err)); }
  };
  const removeCategory = async (id: string) => {
    if (!confirm(t('dash.catalog.confirmDeleteCategory', 'Delete this category? Products keep working but lose this label.'))) return;
    try { await api.delete(`/categories/${id}`); await load(); } catch (err) { setError(msg(err)); }
  };

  // ── Brands ────────────────────────────────────────────────────────────────
  const addBrand = async () => {
    if (!brandCode.trim() || !brandName.trim()) return;
    try { await api.post('/brands', { code: brandCode.trim(), name: brandName.trim(), color: brandColor, appliesTo: brandAppliesTo }); setBrandCode(''); setBrandName(''); setBrandColor('#1652F0'); setBrandAppliesTo('both'); await load(); }
    catch (err) { setError(msg(err)); }
  };
  const saveBrand = async (id: string) => {
    if (!editBrandName.trim()) return;
    try { await api.put(`/brands/${id}`, { name: editBrandName.trim(), color: editBrandColor, appliesTo: editBrandAppliesTo }); setEditBrandId(null); await load(); }
    catch (err) { setError(msg(err)); }
  };
  const removeBrand = async (id: string) => {
    if (!confirm(t('dash.catalog.confirmDeleteBrand', 'Delete this brand? Products keep working but lose this label.'))) return;
    try { await api.delete(`/brands/${id}`); await load(); } catch (err) { setError(msg(err)); }
  };

  const appliesToSelect = (value: AppliesTo, onChange: (v: AppliesTo) => void, ariaLabel: string) => (
    <select aria-label={ariaLabel} className="input-field" value={value} onChange={(e) => onChange(e.target.value as AppliesTo)}>
      <option value="service">{t('dash.catalog.forServices', 'Services')}</option>
      <option value="product">{t('dash.catalog.forProducts', 'Products')}</option>
      <option value="both">{t('dash.catalog.forBoth', 'Both')}</option>
    </select>
  );

  return (
    <div data-testid="catalog-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">{t('dash.catalog.title', 'Business Units, Categories & Brands')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('dash.catalog.subtitle', 'Define the brands and categories used to label and group your services and products.')}</p>
        <p className="mt-1 text-xs text-text-muted">{t('dash.catalog.usageHint', 'The "Applies to" setting decides where each label appears: a Services label shows only in the Service form, a Products label only in the Product form, and Both shows in both.')}</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Business units (AIRIN-176) sit above categories/brands: they are the
          coarsest grouping, and the one the POS tabs are built from. */}
      <div className="mb-6">
        <BusinessUnitsPanel />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Categories */}
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.catalog.categories', 'Categories')}</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input aria-label={t('dash.catalog.newCategoryName', 'New category name')} className="input-field flex-1 min-w-[8rem]" placeholder={t('dash.catalog.newCategoryName', 'New category name')} value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
            {appliesToSelect(catAppliesTo, setCatAppliesTo, t('dash.catalog.appliesTo', 'Applies to'))}
            <button className="btn-primary" onClick={addCategory} disabled={!catName.trim()}>{t('dash.catalog.add', 'Add')}</button>
          </div>
          {categories.length === 0 ? <p className="text-sm text-text-muted">{t('dash.catalog.noCategories', 'No categories.')}</p> : SECTIONS.map((section) => {
            const rows = categories.filter((c) => c.appliesTo === section);
            if (rows.length === 0) return null;
            return (
              <div key={section} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">{appliesToLabel(section)}</h3>
                <div className="space-y-1.5">
                  {rows.map((c) => (
                    <div key={c.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                      {editCatId === c.id ? (
                        <>
                          <input className="input-field flex-1 py-1 mr-2" value={editCatName} autoFocus onChange={(e) => setEditCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveCategory(c.id); if (e.key === 'Escape') setEditCatId(null); }} />
                          <div className="mr-2 shrink-0">{appliesToSelect(editCatAppliesTo, setEditCatAppliesTo, t('dash.catalog.appliesTo', 'Applies to'))}</div>
                          <div className="flex gap-1 shrink-0">
                            <button className="btn-ghost text-xs text-primary-600" onClick={() => saveCategory(c.id)}>{t('dash.catalog.save', 'Save')}</button>
                            <button className="btn-ghost text-xs" onClick={() => setEditCatId(null)}>{t('dash.catalog.cancel', 'Cancel')}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-text-primary">{c.name}</span>
                          <div className="flex gap-1 shrink-0">
                            <button className="btn-ghost text-xs" onClick={() => { setEditCatId(c.id); setEditCatName(c.name); setEditCatAppliesTo(c.appliesTo); }}>{t('dash.catalog.edit', 'Edit')}</button>
                            <button className="btn-ghost text-xs text-red-600" onClick={() => removeCategory(c.id)}>{t('dash.catalog.delete', 'Delete')}</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Brands */}
        <div className="card">
          <h2 className="section-title mb-3">{t('dash.catalog.brands', 'Brands')}</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input aria-label={t('dash.catalog.code', 'CODE')} className="input-field w-20 uppercase" placeholder={t('dash.catalog.code', 'CODE')} maxLength={10} value={brandCode} onChange={(e) => setBrandCode(e.target.value.toUpperCase())} />
            <input aria-label={t('dash.catalog.brandName', 'Brand name')} className="input-field flex-1 min-w-[8rem]" placeholder={t('dash.catalog.brandName', 'Brand name')} value={brandName} onChange={(e) => setBrandName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBrand(); }} />
            <input aria-label={t('dash.catalog.brandColor', 'Brand Color')} type="color" className="input-field w-12 h-10 p-1" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
            {appliesToSelect(brandAppliesTo, setBrandAppliesTo, t('dash.catalog.appliesTo', 'Applies to'))}
            <button className="btn-primary" onClick={addBrand} disabled={!brandCode.trim() || !brandName.trim()}>{t('dash.catalog.add', 'Add')}</button>
          </div>
          {brands.length === 0 ? <p className="text-sm text-text-muted">{t('dash.catalog.noBrands', 'No brands.')}</p> : SECTIONS.map((section) => {
            const rows = brands.filter((b) => b.appliesTo === section);
            if (rows.length === 0) return null;
            return (
              <div key={section} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">{appliesToLabel(section)}</h3>
                <div className="space-y-1.5">
                  {rows.map((b) => (
                    <div key={b.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                      {editBrandId === b.id ? (
                        <>
                          <input type="color" className="input-field w-10 h-8 p-0.5 mr-2 shrink-0" value={editBrandColor} onChange={(e) => setEditBrandColor(e.target.value)} />
                          <input className="input-field flex-1 py-1 mr-2" value={editBrandName} autoFocus onChange={(e) => setEditBrandName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveBrand(b.id); if (e.key === 'Escape') setEditBrandId(null); }} />
                          <div className="mr-2 shrink-0">{appliesToSelect(editBrandAppliesTo, setEditBrandAppliesTo, t('dash.catalog.appliesTo', 'Applies to'))}</div>
                          <div className="flex gap-1 shrink-0">
                            <button className="btn-ghost text-xs text-primary-600" onClick={() => saveBrand(b.id)}>{t('dash.catalog.save', 'Save')}</button>
                            <button className="btn-ghost text-xs" onClick={() => setEditBrandId(null)}>{t('dash.catalog.cancel', 'Cancel')}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex items-center gap-2 text-sm text-text-primary min-w-0">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: b.color }} />
                            <span className="font-mono text-xs badge bg-sky-50 text-sky-700">{b.code}</span>
                            <span className="truncate">{b.name}</span>
                          </span>
                          <div className="flex gap-1 shrink-0">
                            <button className="btn-ghost text-xs" onClick={() => { setEditBrandId(b.id); setEditBrandName(b.name); setEditBrandColor(b.color); setEditBrandAppliesTo(b.appliesTo); }}>{t('dash.catalog.edit', 'Edit')}</button>
                            <button className="btn-ghost text-xs text-red-600" onClick={() => removeBrand(b.id)}>{t('dash.catalog.delete', 'Delete')}</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
