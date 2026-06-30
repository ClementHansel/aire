'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { setSession, type AuthSession } from '@/lib/auth';

const DEMO_ACCOUNTS = [
  { label: 'Super Admin', email: 'superadmin@aire.com', password: 'password123', desc: 'Platform-wide administration' },
  { label: 'Tenant Owner', email: 'owner@demo.com', password: 'password123', desc: 'Full business owner access' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('owner@demo.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    setError('');
    try {
      const session = await api.post<AuthSession>('/auth/login', { email: loginEmail, password: loginPassword });
      setSession(session);
      window.location.href = '/hub';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message.includes('credentials') || message.includes('401') ? 'Invalid email or password' : message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doLogin(email, password);
  };

  // Autofill the form and sign in as the chosen demo account (real auth).
  const useDemo = (acc: { email: string; password: string }) => {
    setEmail(acc.email);
    setPassword(acc.password);
    doLogin(acc.email, acc.password);
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-500 rounded-2xl mb-4">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary">AIRE Operations</h1>
          <p className="mt-2 text-sm text-text-secondary">Sign in to manage your car wash operations</p>
        </div>

        {/* Demo accounts */}
        <div className="card mb-4">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Try a demo account</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => useDemo(acc)}
                disabled={loading}
                className="text-left rounded-lg border border-border p-3 hover:border-primary-300 hover:bg-primary-50 transition-colors disabled:opacity-50"
              >
                <p className="font-medium text-text-primary text-sm">{acc.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{acc.desc}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-2">Clicking autofills the credentials and signs you in.</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1.5">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required className="input-field" />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1.5">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="input-field" />
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" className="rounded border-border" /> Remember me
              </label>
              <a href="/reset-password" className="text-sm text-primary-600 hover:text-primary-700 font-medium">Forgot password?</a>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border text-center">
            <p className="text-sm text-text-secondary">
              Don&apos;t have an account?{' '}
              <a href="/register" className="text-primary-600 hover:text-primary-700 font-medium">Create one</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
