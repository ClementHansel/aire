'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Category { id: string; name: string; sortOrder: number; isActive: boolean }
interface Brand { id: string; code: string; name: string; color: string; isActive: boolean }

export default function CatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState('');
  const [catName, setCatName] = useState('');
  const [brandCode, setBrandCode] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('#1652F0');

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, b] = await Promise.all([api.get<Category[]>('/categories'), api.get<Brand[]>('/brands')]);
      setCategories(c); setBrands(b);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addCategory = async () => {
    if (!catName.trim()) return;
    try { await api.post('/categories', { name: catName.trim() }); setCatName(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const removeCategory = async (id: string) => {
    if (!confirm('Delete category?')) return;
    try { await api.delete(`/categories/${id}`); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const addBrand = async () => {
    if (!brandCode.trim() || !brandName.trim()) return;
    try { await api.post('/brands', { code: brandCode.trim(), name: brandName.trim(), color: brandColor }); setBrandCode(''); setBrandName(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const removeBrand = async (id: string) => {
    if (!confirm('Delete brand?')) return;
    try { await api.delete(`/brands/${id}`); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };

  return (
    <div data-testid="catalog-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Catalog</h1>
        <p className="mt-1 text-sm text-text-secondary">Manage product categories and brands. A product must reference a category and a brand.</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Categories */}
        <div className="card">
          <h2 className="section-title mb-3">Categories</h2>
          <div className="flex gap-2 mb-3">
            <input aria-label="New category name" className="input-field flex-1" placeholder="New category name" value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
            <button className="btn-primary" onClick={addCategory}>Add</button>
          </div>
          <div className="space-y-1.5">
            {categories.length === 0 ? <p className="text-sm text-text-muted">No categories.</p> : categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                <span className="text-sm text-text-primary">{c.name}</span>
                <button className="btn-ghost text-xs text-red-600" onClick={() => removeCategory(c.id)}>Delete</button>
              </div>
            ))}
          </div>
        </div>

        {/* Brands */}
        <div className="card">
          <h2 className="section-title mb-3">Brands</h2>
          <div className="flex gap-2 mb-3">
            <input aria-label="CODE" className="input-field w-20 uppercase" placeholder="CODE" maxLength={10} value={brandCode} onChange={(e) => setBrandCode(e.target.value.toUpperCase())} />
            <input aria-label="Brand name" className="input-field flex-1" placeholder="Brand name" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            <input aria-label="Brand Color" type="color" className="input-field w-12 h-10 p-1" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
            <button className="btn-primary" onClick={addBrand}>Add</button>
          </div>
          <div className="space-y-1.5">
            {brands.length === 0 ? <p className="text-sm text-text-muted">No brands.</p> : brands.map((b) => (
              <div key={b.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-text-primary">
                  <span className="w-3 h-3 rounded-full" style={{ background: b.color }} />
                  <span className="font-mono text-xs badge bg-sky-50 text-sky-700">{b.code}</span> {b.name}
                </span>
                <button className="btn-ghost text-xs text-red-600" onClick={() => removeBrand(b.id)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
