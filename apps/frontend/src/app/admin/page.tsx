'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Tenant status matching backend TenantStatus type.
 */
export type TenantStatus = 'active' | 'suspended' | 'cancelled';

/**
 * Tenant record as displayed in the admin dashboard.
 */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  createdAt: string;
}

/**
 * Platform configuration for default plans, pricing tiers, and feature flags.
 */
export interface PlatformConfig {
  defaultPlans: string[];
  pricingTiers: Record<string, unknown>[];
  featureFlags: Record<string, boolean>;
}

/**
 * Props for the TenantRow component.
 */
interface TenantRowProps {
  tenant: Tenant;
  onEdit: (tenant: Tenant) => void;
  onSuspend: (tenantId: string) => void;
  onReactivate: (tenantId: string) => void;
}

/**
 * Status badge color mapping.
 */
function getStatusColor(status: TenantStatus): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'suspended':
      return '#f59e0b';
    case 'cancelled':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

/**
 * Format date for display.
 */
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Individual tenant row in the tenant list.
 */
function TenantRow({ tenant, onEdit, onSuspend, onReactivate }: TenantRowProps) {
  return (
    <tr data-testid={`tenant-row-${tenant.id}`}>
      <td style={{ padding: '0.75rem' }}>{tenant.name}</td>
      <td style={{ padding: '0.75rem' }}>
        <span
          data-testid={`tenant-status-${tenant.id}`}
          style={{
            backgroundColor: getStatusColor(tenant.status),
            color: '#fff',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {tenant.status}
        </span>
      </td>
      <td style={{ padding: '0.75rem' }}>{tenant.plan}</td>
      <td style={{ padding: '0.75rem' }}>{formatDate(tenant.createdAt)}</td>
      <td style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem' }}>
        <button
          data-testid={`edit-tenant-${tenant.id}`}
          onClick={() => onEdit(tenant)}
          style={{
            padding: '0.25rem 0.75rem',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          Edit
        </button>
        {tenant.status === 'active' && (
          <button
            data-testid={`suspend-tenant-${tenant.id}`}
            onClick={() => onSuspend(tenant.id)}
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: '#f59e0b',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Suspend
          </button>
        )}
        {tenant.status === 'suspended' && (
          <button
            data-testid={`reactivate-tenant-${tenant.id}`}
            onClick={() => onReactivate(tenant.id)}
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Reactivate
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Create/Edit tenant form dialog.
 */
interface TenantFormProps {
  tenant: Tenant | null;
  onSave: (data: { name: string; slug: string; plan: string }) => void;
  onCancel: () => void;
}

function TenantForm({ tenant, onSave, onCancel }: TenantFormProps) {
  const [name, setName] = useState(tenant?.name ?? '');
  const [slug, setSlug] = useState(tenant?.slug ?? '');
  const [plan, setPlan] = useState(tenant?.plan ?? 'standard');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, slug, plan });
  };

  return (
    <div
      data-testid="tenant-form-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="tenant-form"
        style={{
          backgroundColor: '#fff',
          padding: '2rem',
          borderRadius: '8px',
          width: '400px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <h3 style={{ margin: 0 }}>{tenant ? 'Edit Tenant' : 'Create Tenant'}</h3>
        <div>
          <label htmlFor="tenant-name" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
            Name
          </label>
          <input
            id="tenant-name"
            data-testid="tenant-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
          />
        </div>
        <div>
          <label htmlFor="tenant-slug" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
            Slug
          </label>
          <input
            id="tenant-slug"
            data-testid="tenant-slug-input"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
          />
        </div>
        <div>
          <label htmlFor="tenant-plan" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
            Plan
          </label>
          <select
            id="tenant-plan"
            data-testid="tenant-plan-select"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
          >
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="tenant-form-cancel"
            onClick={onCancel}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#e5e7eb',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="tenant-form-save"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {tenant ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Platform configuration panel.
 */
interface ConfigPanelProps {
  config: PlatformConfig;
  onToggleFlag: (flag: string) => void;
}

function ConfigPanel({ config, onToggleFlag }: ConfigPanelProps) {
  return (
    <section data-testid="config-panel" style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Platform Configuration</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div data-testid="config-plans" style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Default Plans</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {config.defaultPlans.map((plan) => (
              <li key={plan} style={{ padding: '0.25rem 0', fontSize: '0.875rem' }}>
                • {plan}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="config-feature-flags" style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Feature Flags</h3>
          {Object.keys(config.featureFlags).length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>No feature flags configured</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {Object.entries(config.featureFlags).map(([flag, enabled]) => (
                <li key={flag} style={{ padding: '0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    data-testid={`toggle-flag-${flag}`}
                    onClick={() => onToggleFlag(flag)}
                    style={{
                      width: '36px',
                      height: '20px',
                      borderRadius: '10px',
                      border: 'none',
                      backgroundColor: enabled ? '#22c55e' : '#d1d5db',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                    aria-label={`Toggle ${flag}`}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: '2px',
                        left: enabled ? '18px' : '2px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: '#fff',
                        transition: 'left 0.2s',
                      }}
                    />
                  </button>
                  <span style={{ fontSize: '0.875rem' }}>{flag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Platform Admin Dashboard page.
 *
 * Displays a list of all tenants with status, plan, and creation date.
 * Provides actions to create, edit, suspend, and reactivate tenants.
 * Includes platform configuration panel.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [config, setConfig] = useState<PlatformConfig>({
    defaultPlans: ['standard', 'premium', 'enterprise'],
    pricingTiers: [],
    featureFlags: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tenants');
      if (!res.ok) throw new Error(`Failed to fetch tenants: ${res.status}`);
      const data: Tenant[] = await res.json();
      setTenants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tenants');
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/config');
      if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
      const data: PlatformConfig = await res.json();
      setConfig(data);
    } catch {
      // Use default config on error
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTenants(), fetchConfig()]).finally(() => setLoading(false));
  }, [fetchTenants, fetchConfig]);

  const handleCreate = () => {
    setEditingTenant(null);
    setFormOpen(true);
  };

  const handleEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setFormOpen(true);
  };

  const handleSave = async (data: { name: string; slug: string; plan: string }) => {
    try {
      if (editingTenant) {
        const res = await fetch(`/api/admin/tenants/${editingTenant.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to update tenant');
      } else {
        const res = await fetch('/api/admin/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to create tenant');
      }
      setFormOpen(false);
      setEditingTenant(null);
      await fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleSuspend = async (tenantId: string) => {
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/suspend`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to suspend tenant');
      await fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suspend failed');
    }
  };

  const handleReactivate = async (tenantId: string) => {
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/reactivate`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to reactivate tenant');
      await fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reactivate failed');
    }
  };

  const handleToggleFlag = async (flag: string) => {
    const updatedFlags = { ...config.featureFlags, [flag]: !config.featureFlags[flag] };
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFlags: updatedFlags }),
      });
      if (!res.ok) throw new Error('Failed to update config');
      setConfig((prev) => ({ ...prev, featureFlags: updatedFlags }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Config update failed');
    }
  };

  if (loading) {
    return (
      <div data-testid="admin-loading" style={{ padding: '2rem' }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div data-testid="admin-dashboard">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Platform Admin Dashboard</h1>
        <button
          data-testid="create-tenant-btn"
          onClick={handleCreate}
          style={{
            padding: '0.5rem 1.25rem',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Create Tenant
        </button>
      </header>

      {error && (
        <div
          data-testid="admin-error"
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            borderRadius: '6px',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Tenant List - Requirement 4.1 */}
      <section data-testid="tenant-list-section">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
          Tenants ({tenants.length})
        </h2>
        {tenants.length === 0 ? (
          <p data-testid="no-tenants" style={{ color: '#6b7280' }}>
            No tenants found. Create one to get started.
          </p>
        ) : (
          <table
            data-testid="tenant-table"
            style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden' }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
                <th style={{ padding: '0.75rem' }}>Plan</th>
                <th style={{ padding: '0.75rem' }}>Created</th>
                <th style={{ padding: '0.75rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <TenantRow
                  key={tenant.id}
                  tenant={tenant}
                  onEdit={handleEdit}
                  onSuspend={handleSuspend}
                  onReactivate={handleReactivate}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Platform Configuration - Requirement 4.3 */}
      <ConfigPanel config={config} onToggleFlag={handleToggleFlag} />

      {/* Tenant Form Dialog - Requirement 4.2 */}
      {formOpen && (
        <TenantForm
          tenant={editingTenant}
          onSave={handleSave}
          onCancel={() => {
            setFormOpen(false);
            setEditingTenant(null);
          }}
        />
      )}
    </div>
  );
}
