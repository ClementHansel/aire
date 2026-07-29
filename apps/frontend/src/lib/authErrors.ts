/**
 * Turns an auth failure into something a human can act on.
 *
 * The API rejects with SCREAMING_SNAKE codes (`AUTH_INVALID_CREDENTIALS`, see
 * ERR_AUTH_* in @aire/shared/error-codes). The login screen used to test
 * `message.includes('credentials')` — case-SENSITIVE — so the uppercase code
 * never matched and the raw `AUTH_INVALID_CREDENTIALS` was shown to whoever was
 * trying to sign in. Found on production while verifying AIRIN-93.
 *
 * The rule that matters: a raw error code must never reach the screen. Anything
 * that still looks like a code after mapping falls back to a generic sentence.
 */

/** True for strings shaped like an error code: SCREAMING_SNAKE, no spaces. */
export function looksLikeErrorCode(message: string): boolean {
  return /^[A-Z][A-Z0-9_]{3,}$/.test(message.trim());
}

/**
 * @param message  raw error text or code from the API
 * @param t        i18n lookup, so the caller keeps control of wording/locale
 */
export function friendlyAuthError(
  message: string,
  t: (key: string, fallback: string) => string,
): string {
  const m = (message ?? '').trim();
  const lower = m.toLowerCase();

  // Wrong email/password — by far the common case.
  if (lower.includes('invalid_credentials') || lower.includes('credentials') || lower.includes('401')) {
    return t('auth.login.invalidCreds', 'Invalid email or password');
  }
  if (lower.includes('too_many') || lower.includes('429')) {
    return t('auth.login.tooManyAttempts', 'Too many failed attempts. Please try again later.');
  }
  if (lower.includes('inactive') || lower.includes('disabled') || lower.includes('suspended')) {
    return t('auth.login.accountInactive', 'This account is inactive. Contact your administrator.');
  }
  if (lower.includes('token_expired') || lower.includes('token_invalid')) {
    return t('auth.login.sessionExpired', 'Your session expired. Please sign in again.');
  }

  // Never surface a bare code; prefer a generic sentence over leaking internals.
  if (!m || looksLikeErrorCode(m)) {
    return t('auth.login.failed', 'Sign-in failed. Please try again.');
  }
  return m;
}
