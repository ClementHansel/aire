'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, Field, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtDate } from '@/components/dashboard/ui';

interface PlatformUser { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }

function CreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try { await api.post('/admin/platform-users', form); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.users.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      title={t('admin.users.createAdmin', 'New platform admin')}
      onClose={onClose}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('admin.users.cancel', 'Cancel')}</button>
        <button type="submit" form="pu-form" className="btn-primary" disabled={saving}>{saving ? t('admin.users.saving', 'Saving…') : t('admin.users.create', 'Create')}</button>
      </>}
    >
      <form id="pu-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label={t('admin.users.name', 'Name')}><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label={t('admin.users.email', 'Email')}><input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label={t('admin.users.password', 'Password')} hint={t('admin.users.passwordHint', 'At least 8 characters.')}><input className="input-field" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
      </form>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSaved }: { user: PlatformUser; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try { await api.post(`/admin/platform-users/${user.id}/password`, { password }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.users.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      title={`${t('admin.users.resetPassword', 'Reset password')} · ${user.name}`}
      onClose={onClose}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('admin.users.cancel', 'Cancel')}</button>
        <button type="submit" form="pw-form" className="btn-primary" disabled={saving}>{saving ? t('admin.users.saving', 'Saving…') : t('admin.users.setPassword', 'Set password')}</button>
      </>}
    >
      <form id="pw-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label={t('admin.users.newPassword', 'New password')} hint={t('admin.users.passwordHint', 'At least 8 characters.')}><input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus /></Field>
      </form>
    </Modal>
  );
}

export default function AdminUsersPage() {
  const { t } = useI18n();
  const me = getUser();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [pwFor, setPwFor] = useState<PlatformUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setUsers(await api.get<PlatformUser[]>('/admin/platform-users')); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.users.failedToLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (me?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    load();
  }, [load, me?.role]);

  const setActive = async (u: PlatformUser, isActive: boolean) => {
    try { await api.patch(`/admin/platform-users/${u.id}/active`, { isActive }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.users.actionFailed', 'Action failed')); }
  };

  return (
    <div className="space-y-6" data-testid="admin-users">
      <PageHeader
        title={t('admin.users.title', 'Platform Users')}
        subtitle={t('admin.users.subtitle', 'Operator accounts with platform super-admin access. These accounts are not tied to any tenant.')}
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ {t('admin.users.createAdmin', 'New platform admin')}</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={4} cols={5} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.users.name', 'Name')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.users.email', 'Email')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.users.status', 'Status')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.users.since', 'Since')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.users.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.length === 0 ? (
                <EmptyRow colSpan={5}>{t('admin.users.none', 'No platform admins.')}</EmptyRow>
              ) : users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-sunken/50">
                  <td className={cn(tdCls, 'font-medium')}>{u.name}{u.id === me?.id && <span className="ml-2 badge bg-primary-50 text-primary-700 text-xs">{t('admin.users.you', 'you')}</span>}</td>
                  <td className={cn(tdCls, 'text-text-muted')}>{u.email}</td>
                  <td className={tdCls}><span className={cn('badge', u.isActive ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}>{u.isActive ? t('admin.users.activeBadge', 'Active') : t('admin.users.inactiveBadge', 'Inactive')}</span></td>
                  <td className={cn(tdCls, 'text-xs text-text-muted whitespace-nowrap')}>{fmtDate(u.createdAt)}</td>
                  <td className={cn(tdCls, 'text-right whitespace-nowrap')}>
                    <button className="btn-ghost text-xs" onClick={() => setPwFor(u)}>{t('admin.users.resetPassword', 'Reset password')}</button>
                    {u.id !== me?.id && (
                      u.isActive
                        ? <button className="btn-ghost text-xs text-amber-600" onClick={() => setActive(u, false)}>{t('admin.users.deactivate', 'Deactivate')}</button>
                        : <button className="btn-ghost text-xs text-green-600" onClick={() => setActive(u, true)}>{t('admin.users.activate', 'Activate')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {creating && <CreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {pwFor && <PasswordModal user={pwFor} onClose={() => setPwFor(null)} onSaved={() => setPwFor(null)} />}
    </div>
  );
}
