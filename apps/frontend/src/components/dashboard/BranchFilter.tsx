'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

interface OutletLite {
  id: string;
  name: string;
}

/**
 * Roles that span multiple branches and may therefore filter by branch.
 * Cashier / Outlet_Admin are scoped to their own outlet by RLS on the server,
 * so a cross-branch selector would be meaningless for them.
 */
export function canFilterBranches(role?: string): boolean {
  return role === 'tenant_owner' || role === 'platform_super_admin';
}

/**
 * Reusable per-page branch (outlet) filter.
 *
 * - The tenant is always implicit (JWT-scoped); this only ever narrows by branch.
 * - Controlled: the parent owns the selected outletId ('' = all branches).
 * - Renders nothing for outlet-scoped roles — those users already see only their
 *   own branch's data, so pages should simply omit `outletId` and let RLS scope it.
 */
export default function BranchFilter({
  value,
  onChange,
  className,
  label,
}: {
  value: string;
  onChange: (outletId: string) => void;
  className?: string;
  label?: string;
}) {
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!canFilterBranches(u?.role)) return;
    setVisible(true);
    api.get<OutletLite[]>('/outlets').then(setOutlets).catch(() => setOutlets([]));
  }, []);

  if (!visible) return null;

  const select = (
    <select
      aria-label={label ?? 'Branch'}
      data-testid="branch-filter"
      className={className ?? 'input-field max-w-[220px]'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All branches (global)</option>
      {outlets.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );

  if (label) {
    return (
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
        {select}
      </div>
    );
  }
  return select;
}
