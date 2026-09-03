'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { AirinLogo } from '@/components/shared/AirinLogo';

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [done, setDone] = useState(false);

  const requestToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      const res = await api.post<{ message: string; resetToken?: string }>('/auth/forgot-password', { email });
      setInfo(res.message);
      if (res.resetToken) {
        // No email service is configured in this environment, so the token is
        // surfaced here to complete the reset. Prefill it for convenience.
        setToken(res.resetToken);
      }
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.reset.requestFailed', 'Request failed'));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError(t('auth.reset.pwMin', 'Password must be at least 8 characters')); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: token.trim(), newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.reset.resetFailed', 'Reset failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <AirinLogo size="lg" showWordmark={false} className="mb-4" />
          <h1 className="text-2xl font-bold text-text-primary">{t('auth.reset.title', 'Reset password')}</h1>
        </div>

        <div className="card">
          {done ? (
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
              <p className="text-text-primary font-medium">{t('auth.reset.updated', 'Password updated')}</p>
              <p className="text-sm text-text-secondary mt-1">{t('auth.reset.updatedDesc', 'You can now sign in with your new password.')}</p>
              <a href="/" className="btn-primary w-full mt-5 inline-block text-center">{t('auth.reset.backToSignIn', 'Back to sign in')}</a>
            </div>
          ) : step === 'request' ? (
            <form onSubmit={requestToken} className="space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
              <p className="text-sm text-text-secondary">{t('auth.reset.requestPrompt', 'Enter your account email to get a reset token.')}</p>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">{t('auth.reset.email', 'Email')}</label>
                <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? t('auth.reset.requesting', 'Requesting…') : t('auth.reset.requestToken', 'Request reset token')}</button>
            </form>
          ) : (
            <form onSubmit={reset} className="space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
              {info && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">{info} {t('auth.reset.tokenPrefilledNote', 'The token below is prefilled (email delivery is not configured in this environment).')}</div>}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">{t('auth.reset.tokenLabel', 'Reset token')}</label>
                <input className="input-field font-mono text-sm" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('auth.reset.tokenPlaceholder', 'Paste your reset token')} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">{t('auth.reset.newPassword', 'New password')}</label>
                <input className="input-field" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('auth.reset.pwPlaceholder', 'At least 8 characters')} required />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? t('auth.reset.updating', 'Updating…') : t('auth.reset.setNewPassword', 'Set new password')}</button>
            </form>
          )}
          <div className="mt-6 pt-5 border-t border-border text-center">
            <p className="text-sm text-text-secondary"><a href="/" className="text-primary-600 hover:text-primary-700 font-medium">{t('auth.reset.backToSignIn', 'Back to sign in')}</a></p>
          </div>
        </div>
      </div>
    </div>
  );
}
