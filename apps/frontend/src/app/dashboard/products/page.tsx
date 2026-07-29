'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { barcodeDataUrl } from '@/lib/cardCodes';
import { buildDocHtml, type DocTemplate } from '@/components/dashboard/DocumentRenderer';
import {
  ServiceModal,
  RecipeModal,
  BUSINESS_UNIT_LABEL,
  CATALOG_LABEL,
  type ServiceDTO,
  type Category,
  type Brand,
  type BranchLite,
} from '../services/service-forms';

export default function ProductsPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<ServiceDTO[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [recipeFor, setRecipeFor] = useState<ServiceDTO | null>(null);

  const brandById = useCallback((id: string | null) => id ? brands.find((b) => b.id === id) ?? null : null, [brands]);
  const categoryById = useCallback((id: string | null) => id ? categories.find((c) => c.id === id) ?? null : null, [categories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, cats, brs, outs] = await Promise.all([
        api.get<ServiceDTO[]>('/products'),
        api.get<Category[]>('/categories').catch(() => [] as Category[]),
        api.get<Brand[]>('/brands').catch(() => [] as Brand[]),
        api.get<BranchLite[]>('/outlets').catch(() => [] as BranchLite[]),
      ]);
      setProducts(data);
      setCategories(cats);
      setBrands(brs);
      setBranches(outs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.products.loadFailed', 'Failed to load products'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm(t('dash.products.confirmDelete', 'Delete this product?'))) return;
    try {
      await api.delete(`/products/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.products.deleteFailed', 'Delete failed'));
    }
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (p: ServiceDTO) => { setEditing(p); setModalOpen(true); };

  /** Print a barcode label for a product using the tenant's 'label' template. */
  const printLabel = async (p: ServiceDTO) => {
    if (!p.barcode) {
      alert(t('dash.products.noBarcode', 'This product has no barcode yet. Add one (or enable auto-generate) first.'));
      return;
    }
    try {
      const tpl = await api.get<DocTemplate>('/doc-template/label');
      const data = {
        fields: {
          product_name: p.name,
          price: `Rp ${p.price.toLocaleString('id-ID')}`,
          barcode: p.barcode,
        },
        items: [],
        totals: [],
        logo: null,
        code: barcodeDataUrl(p.barcode),
      };
      const w = window.open('', '_blank', 'width=520,height=420');
      if (!w) { setError(t('dash.products.popupBlocked', 'Allow pop-ups to print the label.')); return; }
      w.document.write(buildDocHtml(tpl, data, `${p.name} — label`));
      w.document.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.products.labelFailed', 'Failed to print label'));
    }
  };

  return (
    <div data-testid="products-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="products-title">{t('dash.products.title', 'Products')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.products.subtitle', 'Sellable retail items (wax, air freshener, drinks…). Active products appear on the POS menu, and selling one deducts stock via its recipe.')}</p>
        </div>
        <button className="btn-primary" data-testid="add-product-btn" onClick={openAdd}>{t('dash.products.addBtn', '+ Add Product')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.products.loading', 'Loading products…')}</div>
      ) : products.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.products.empty', 'No products yet. Click "Add Product" to create one — it will show up on the POS menu.')}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full" data-testid="products-table">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.products.name', 'Name')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t(BUSINESS_UNIT_LABEL.key, BUSINESS_UNIT_LABEL.fallback)}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t(CATALOG_LABEL.key, CATALOG_LABEL.fallback)}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.products.branches', 'Branches')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.products.priceCol', 'Price')}</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.products.status', 'Status')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.products.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => {
                const cat = categoryById(p.categoryId);
                return (
                  <tr key={p.id} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`product-row-${p.id}`}>
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium text-text-primary">{p.name}</div>
                      {(() => { const b = brandById(p.brandId); return b ? (
                        <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-muted">
                          <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                          {b.code} · {b.name}
                        </span>
                      ) : null; })()}
                    </td>
                    <td className="px-5 py-3.5"><span className={`badge ${p.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{p.businessUnit ?? 'AIRE'}</span></td>
                    <td className="px-5 py-3.5 text-sm text-text-secondary">{cat ? cat.name : <span className="text-text-muted">—</span>}</td>
                    <td className="px-5 py-3.5 text-xs">
                      {!p.outletIds || p.outletIds.length === 0
                        ? <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.products.allBranches', 'All branches')}</span>
                        : (
                          <span className="flex flex-wrap gap-1">
                            {p.outletIds.map((id) => (
                              <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">
                                {branches.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
                              </span>
                            ))}
                          </span>
                        )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-text-primary text-right font-mono">Rp {p.price.toLocaleString('id-ID')}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`badge ${p.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? t('dash.products.active', 'Active') : t('dash.products.inactive', 'Inactive')}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs" onClick={() => setRecipeFor(p)}>{t('dash.products.stock', 'Stock / Recipe')}</button>
                      <button className="btn-ghost text-xs" onClick={() => void printLabel(p)}>{t('dash.products.printLabel', 'Print label')}</button>
                      <button className="btn-ghost text-xs" onClick={() => openEdit(p)}>{t('dash.products.edit', 'Edit')}</button>
                      <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(p.id)}>{t('dash.products.delete', 'Delete')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ServiceModal
          initial={editing}
          categories={categories}
          brands={brands}
          branches={branches}
          lockedCategory="product"
          basePath="/products"
          titles={{ add: t('dash.products.addTitle', 'Add Product'), edit: t('dash.products.editTitle', 'Edit Product') }}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}

      {recipeFor && <RecipeModal service={recipeFor} onClose={() => setRecipeFor(null)} />}
    </div>
  );
}
