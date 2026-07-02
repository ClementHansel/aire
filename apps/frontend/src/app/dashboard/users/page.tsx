'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Branch { id: string; name: string }
interface UserRow { id: string; name: string; email: string; role: string; isActive: boolean; outletIds: string[]; customRoleId: string | null }
interface RoleRow { id: string; name: string; description: string | null; baseRole: string; permissions: string[]; isSystem: boolean }
interface PermGroup { group: string; permissions: { key: string; label: string }[] }

const BASE_ROLES = ['tenant_owner', 'outlet_admin', 'cashier'];

function UserModal({ initial, branches, roles, onClose, onSaved }: { initial: UserRow | null; branches: Branch[]; roles: RoleRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(initial?.role ?? 'cashier');
  const [customRoleId, setCustomRoleId] = useState(initial?.customRoleId ?? '');
  const [outletIds, setOutletIds] = useState<string[]>(initial?.outletIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleBranch = (id: string) => setOutletIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (initial) {
        await api.put(`/users/${initial.id}`, { name, role, customRoleId: customRoleId || null, outletIds, ...(password ? { password } : {}) });
      } else {
        await api.post('/users', { name, email, password, role, customRoleId: customRoleId || null, outletIds });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit User' : 'Add User'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Name</label><input aria-label="Name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">Email</label><input aria-label="Email" className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!initial} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Base role</label>
              <select aria-label="Role" className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
                {BASE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Custom role (optional)</label>
              <select aria-label="Custom Role Id" className="input-field" value={customRoleId} onChange={(e) => setCustomRoleId(e.target.value)}>
                <option value="">— none —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{initial ? 'New password (leave blank to keep)' : 'Password'}</label>
            <input aria-label="Password" className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!initial} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Branch placement (multi-select)</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-auto border border-border rounded-lg p-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={outletIds.includes(b.id)} onChange={() => toggleBranch(b.id)} /> {b.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleModal({ initial, perms, onClose, onSaved }: { initial: RoleRow | null; perms: PermGroup[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseRole, setBaseRole] = useState(initial?.baseRole ?? 'cashier');
  const [selected, setSelected] = useState<string[]>(initial?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = (k: string) => setSelected((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (initial) await api.put(`/roles/${initial.id}`, { name, baseRole, permissions: selected });
      else await api.post('/roles', { name, baseRole, permissions: selected });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Role' : 'Add Role'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Role name</label><input aria-label="Name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Base role (hierarchy)</label>
              <select aria-label="Base Role" className="input-field" value={baseRole} onChange={(e) => setBaseRole(e.target.value)}>
                {BASE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Permissions</label>
            <div className="space-y-3 max-h-72 overflow-auto border border-border rounded-lg p-3">
              {perms.map((g) => (
                <div key={g.group}>
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">{g.group}</p>
                  <div className="grid grid-cols-1 gap-1">
                    {g.permissions.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-sm text-text-secondary">
                        <input type="checkbox" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} /> {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [perms, setPerms] = useState<PermGroup[]>([]);
  const [error, setError] = useState('');
  const [userModal, setUserModal] = useState<{ open: boolean; editing: UserRow | null }>({ open: false, editing: null });
  const [roleModal, setRoleModal] = useState<{ open: boolean; editing: RoleRow | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setError('');
    try {
      const [u, r, b, p] = await Promise.all([
        api.get<UserRow[]>('/users'), api.get<RoleRow[]>('/roles'), api.get<Branch[]>('/outlets'), api.get<PermGroup[]>('/permissions'),
      ]);
      setUsers(u); setRoles(r); setBranches(b); setPerms(p);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const branchNames = (ids: string[]) => ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(', ') || '—';

  return (
    <div data-testid="users-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Users & Roles</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage staff, multi-branch placement, and dynamic role permissions.</p>
        </div>
        {tab === 'users'
          ? <button className="btn-primary" onClick={() => setUserModal({ open: true, editing: null })}>+ Add User</button>
          : <button className="btn-primary" onClick={() => setRoleModal({ open: true, editing: null })}>+ Add Role</button>}
      </div>

      <div className="inline-flex rounded-full border border-border bg-surface-raised p-0.5 mb-5">
        {(['users', 'roles'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm font-semibold rounded-full capitalize ${tab === t ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>{t}</button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {tab === 'users' ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Name</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Role</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Branches</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{u.name}<div className="text-xs text-text-muted">{u.email}</div></td>
                  <td className="px-5 py-3.5 text-sm capitalize">{u.role.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{branchNames(u.outletIds)}</td>
                  <td className="px-5 py-3.5 text-center"><span className={`badge ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-5 py-3.5 text-right"><button className="btn-ghost text-xs" onClick={() => setUserModal({ open: true, editing: u })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Role</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Base</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Permissions</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {roles.length === 0 ? <tr><td colSpan={4} className="px-5 py-6 text-sm text-text-muted text-center">No custom roles yet.</td></tr> : roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{r.name}</td>
                  <td className="px-5 py-3.5 text-sm capitalize">{r.baseRole.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-3.5 text-xs text-text-muted">{r.permissions.length} permission(s)</td>
                  <td className="px-5 py-3.5 text-right"><button className="btn-ghost text-xs" onClick={() => setRoleModal({ open: true, editing: r })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {userModal.open && <UserModal initial={userModal.editing} branches={branches} roles={roles} onClose={() => setUserModal({ open: false, editing: null })} onSaved={() => { setUserModal({ open: false, editing: null }); load(); }} />}
      {roleModal.open && <RoleModal initial={roleModal.editing} perms={perms} onClose={() => setRoleModal({ open: false, editing: null })} onSaved={() => { setRoleModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
