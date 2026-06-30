'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { setSession, type AuthSession } from '@/lib/auth';

export default function RegisterPage() {
  const [tenantName, setTenantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const session = await api.post<AuthSession>('/auth/register', { tenantName, name, email, password });
      setSession(session);
      window.location.href = '/hub';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-500 rounded-2xl mb-4"><span className="text-2xl font-bold text-white">A</span></div>
          <h1 className="text-2xl font-bold text-text-primary">Create your account</h1>
          <p className="mt-2 text-sm text-text-secondary">Set up your business on AIRE Operations</p>
        </div>

        <div className="card">
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Business name</label>
              <input className="input-field" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="e.g. Sparkle Car Wash" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Your name</label>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Email</label>
              <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Password</label>
              <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Confirm password</label>
              <input className="input-field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Creating account…' : 'Create account'}</button>
          </form>
          <div className="mt-6 pt-5 border-t border-border text-center">
            <p className="text-sm text-text-secondary">Already have an account? <a href="/" className="text-primary-600 hover:text-primary-700 font-medium">Sign in</a></p>
          </div>
        </div>
      </div>
    </div>
  );
}
