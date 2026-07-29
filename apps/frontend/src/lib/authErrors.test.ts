import { describe, it, expect } from 'vitest';
import { friendlyAuthError, looksLikeErrorCode } from './authErrors';

/** Identity `t` so assertions read against the English fallbacks. */
const t = (_key: string, fallback: string) => fallback;

describe('friendlyAuthError', () => {
  it('maps the API\'s uppercase credentials code to a human sentence', () => {
    // The live bug: the login screen tested message.includes('credentials'),
    // which is case-sensitive, so AUTH_INVALID_CREDENTIALS fell through and the
    // raw code was rendered to whoever was trying to sign in.
    expect(friendlyAuthError('AUTH_INVALID_CREDENTIALS', t)).toBe('Invalid email or password');
  });

  it('handles the lowercase/prose variants too', () => {
    for (const m of ['Invalid credentials', 'invalid credentials', 'Request failed with status 401']) {
      expect(friendlyAuthError(m, t), m).toBe('Invalid email or password');
    }
  });

  it('maps rate limiting', () => {
    expect(friendlyAuthError('AUTH_TOO_MANY_ATTEMPTS', t)).toContain('Too many failed attempts');
  });

  it('maps inactive/suspended accounts', () => {
    expect(friendlyAuthError('ACCOUNT_INACTIVE', t)).toContain('inactive');
  });

  it('maps expired sessions', () => {
    expect(friendlyAuthError('AUTH_TOKEN_EXPIRED', t)).toContain('session expired');
  });

  it('NEVER shows a bare error code, even an unmapped one', () => {
    // The guarantee that matters: no SCREAMING_SNAKE reaches the screen.
    // Deliberately codes that match none of the specific rules — one containing
    // e.g. "SUSPENDED" would (correctly) map to the inactive-account message.
    for (const code of ['SOME_FUTURE_AUTH_CODE', 'ERR_UNKNOWN_THING', 'E_WEIRD']) {
      const out = friendlyAuthError(code, t);
      expect(out, code).toBe('Sign-in failed. Please try again.');
      expect(out).not.toBe(code);
    }
  });

  it('falls back for empty input', () => {
    expect(friendlyAuthError('', t)).toBe('Sign-in failed. Please try again.');
    expect(friendlyAuthError('   ', t)).toBe('Sign-in failed. Please try again.');
  });

  it('passes through a genuine human message unchanged', () => {
    // A real sentence from the server should not be swallowed by the fallback.
    expect(friendlyAuthError('Your account is pending approval by an administrator.', t))
      .toBe('Your account is pending approval by an administrator.');
  });
});

describe('looksLikeErrorCode', () => {
  it('recognises SCREAMING_SNAKE codes', () => {
    for (const c of ['AUTH_INVALID_CREDENTIALS', 'ERR_X_Y', 'ABCD']) {
      expect(looksLikeErrorCode(c), c).toBe(true);
    }
  });

  it('does not mistake ordinary prose for a code', () => {
    for (const s of ['Invalid email or password', 'OK', 'Too many attempts', 'a']) {
      expect(looksLikeErrorCode(s), s).toBe(false);
    }
  });
});
