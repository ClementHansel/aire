'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n, LanguageToggle } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

type FeedbackQuestionType = 'rating' | 'nps' | 'text';
interface FeedbackQuestion { id: string; type: FeedbackQuestionType; label: string; enabled: boolean }
interface FeedbackContext {
  outletName: string | null;
  orderNumber: string | null;
  status: string;
  questions?: FeedbackQuestion[];
}

// Fallback question set for older API responses without a configured set.
const DEFAULT_QUESTIONS: FeedbackQuestion[] = [
  { id: 'rating', type: 'rating', label: 'Your rating', enabled: true },
  { id: 'nps', type: 'nps', label: 'How likely are you to recommend us?', enabled: true },
  { id: 'comment', type: 'text', label: 'Anything else?', enabled: true },
];

/**
 * Public post-service feedback form — opened from the WhatsApp link the customer
 * receives after paying. The unguessable token in the URL is the only credential.
 * Mobile-first; uses plain fetch (unauthenticated), never the authed api client.
 */
export default function FeedbackPage() {
  const params = useParams();
  const token = params.token as string;
  const { t } = useI18n();
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

  const [ctx, setCtx] = useState<FeedbackContext | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [nps, setNps] = useState<number | null>(null);
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const questions = (ctx?.questions && ctx.questions.length ? ctx.questions : DEFAULT_QUESTIONS).filter((q) => q.enabled);
  const ratingQ = questions.find((q) => q.type === 'rating');
  const npsQ = questions.find((q) => q.type === 'nps');
  const textQs = questions.filter((q) => q.type === 'text');

  const load = useCallback(() => {
    fetch(`${base}/public/feedback/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('notfound'))))
      .then((d: FeedbackContext) => setCtx(d))
      .catch(() => setLoadErr(t('feedback.notFound', 'Feedback link not found or the link has expired.')));
  }, [base, token, t]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (rating < 1) { setErr(t('feedback.pickRating', 'Please tap a star rating first.')); return; }
    setBusy(true); setErr('');
    // Build the answer map keyed by question id, plus the standard rating/nps/comment
    // fields the backend uses for its aggregates.
    const answers: Record<string, string | number | null> = {};
    if (ratingQ) answers[ratingQ.id] = rating;
    if (npsQ && nps != null) answers[npsQ.id] = nps;
    for (const q of textQs) { const v = textAnswers[q.id]?.trim(); if (v) answers[q.id] = v; }
    const primaryComment = (textQs.find((q) => q.id === 'comment') ?? textQs[0]);
    const comment = primaryComment ? (textAnswers[primaryComment.id]?.trim() ?? '') : '';
    try {
      const res = await fetch(`${base}/public/feedback/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, nps, comment: comment || undefined, answers }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (res.status === 409) { setCtx((c) => (c ? { ...c, status: 'completed' } : c)); return; }
        if (res.status === 410) { setCtx((c) => (c ? { ...c, status: 'expired' } : c)); return; }
        throw new Error(j?.message || t('feedback.failed', 'Something went wrong. Please try again.'));
      }
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('feedback.failed', 'Something went wrong. Please try again.'));
    } finally { setBusy(false); }
  };

  const alreadyDone = done || ctx?.status === 'completed';
  const expired = ctx?.status === 'expired';

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end"><LanguageToggle /></div>
        <div className="card space-y-5">
          <div>
            <h1 className="text-lg font-bold text-text-primary">{t('feedback.title', 'How was your service?')}</h1>
            {ctx && (ctx.outletName || ctx.orderNumber) && (
              <p className="mt-1 text-sm text-text-secondary">
                {ctx.outletName}{ctx.outletName && ctx.orderNumber ? ' · ' : ''}
                {ctx.orderNumber ? `#${ctx.orderNumber}` : ''}
              </p>
            )}
          </div>

          {loadErr && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{loadErr}</div>}
          {!ctx && !loadErr && <p className="text-sm text-text-muted">{t('feedback.loading', 'Loading…')}</p>}

          {ctx && alreadyDone && (
            <div className="rounded-lg bg-emerald-50 p-4 text-center text-sm font-medium text-emerald-800">
              {t('feedback.thankYou', '✓ Thank you! Your feedback has been recorded.')}
            </div>
          )}

          {ctx && !alreadyDone && expired && (
            <div className="rounded-lg bg-amber-50 p-4 text-center text-sm font-medium text-amber-800">
              {t('feedback.expired', 'This feedback link has expired.')}
            </div>
          )}

          {ctx && !alreadyDone && !expired && (
            <>
              {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{err}</div>}

              {questions.map((q) => {
                if (q.type === 'rating') {
                  return (
                    <div key={q.id}>
                      <p className="mb-2 text-sm font-medium text-text-primary">{q.label || t('feedback.ratingLabel', 'Your rating')}</p>
                      <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-label={`${n}`}
                            onMouseEnter={() => setHover(n)}
                            onMouseLeave={() => setHover(0)}
                            onClick={() => setRating(n)}
                            className={`text-4xl leading-none transition-transform hover:scale-110 ${
                              (hover || rating) >= n ? 'text-amber-400' : 'text-text-muted/40'
                            }`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (q.type === 'nps') {
                  return (
                    <div key={q.id}>
                      <p className="mb-2 text-sm font-medium text-text-primary">
                        {q.label || t('feedback.npsLabel', 'How likely are you to recommend us?')}
                        <span className="ml-1 text-xs font-normal text-text-muted">{t('feedback.optional', '(optional)')}</span>
                      </p>
                      <div className="grid grid-cols-11 gap-1">
                        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setNps((cur) => (cur === n ? null : n))}
                            className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                              nps === n ? 'bg-primary-600 text-white' : 'bg-surface-sunken text-text-secondary hover:bg-surface-sunken/70'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="mt-1 flex justify-between text-2xs text-text-muted">
                        <span>{t('feedback.npsLow', 'Not likely')}</span>
                        <span>{t('feedback.npsHigh', 'Very likely')}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={q.id}>
                    <p className="mb-2 text-sm font-medium text-text-primary">
                      {q.label || t('feedback.commentLabel', 'Anything else?')}
                      <span className="ml-1 text-xs font-normal text-text-muted">{t('feedback.optional', '(optional)')}</span>
                    </p>
                    <textarea
                      className="input-field"
                      rows={3}
                      value={textAnswers[q.id] ?? ''}
                      onChange={(e) => setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={t('feedback.commentPlaceholder', 'Tell us about your experience…')}
                    />
                  </div>
                );
              })}

              <button className="btn-primary w-full" onClick={submit} disabled={busy}>
                {busy ? t('feedback.submitting', 'Submitting…') : t('feedback.submit', 'Submit feedback')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
