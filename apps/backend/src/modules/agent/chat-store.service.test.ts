import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatStoreService, cleanTitle, truncateTitle } from './chat-store.service';

/**
 * The chat store is what makes the assistant feel like a chat product rather than
 * a text box: threads that belong to their owner, titles that survive a rename,
 * and a context window that replays the END of a long conversation.
 */
describe('ChatStoreService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let llm: { chat: ReturnType<typeof vi.fn> };
  let store: ChatStoreService;

  beforeEach(() => {
    pool = { query: vi.fn() };
    llm = { chat: vi.fn() };
    store = new ChatStoreService(pool as never, llm as never);
  });

  describe('ownership', () => {
    it('rejects a non-UUID id without hitting the database', async () => {
      // A bad id would make Postgres throw on the ::uuid cast — a 500 where the
      // honest answer is "not yours".
      const owns = await store.ownsSession({ scope: 'tenant', tenantId: 't1', userId: 'u1', sessionId: 'not-a-uuid' });

      expect(owns).toBe(false);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('scopes the check to scope, tenant and user', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });

      const owns = await store.ownsSession({
        scope: 'platform', tenantId: null, userId: 'u1',
        sessionId: '11111111-2222-3333-4444-555555555555',
      });

      expect(owns).toBe(true);
      expect(pool.query.mock.calls[0]![1]).toEqual([
        '11111111-2222-3333-4444-555555555555', 'platform', null, 'u1',
      ]);
    });

    it('returns no messages for a thread the user does not own', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const msgs = await store.getMessages({
        scope: 'tenant', tenantId: 't1', userId: 'u1',
        sessionId: '11111111-2222-3333-4444-555555555555',
      });

      expect(msgs).toEqual([]);
      expect(pool.query).toHaveBeenCalledTimes(1); // ownership only; never the transcript
    });
  });

  describe('loadHistory', () => {
    // Replaying the START of a long thread would drop what was just said, which
    // is exactly the context the next turn needs.
    it('takes the newest rows but returns them chronologically', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ role: 'user', content: 'a' }] });

      await store.loadHistory('s1', 5);

      const sql = pool.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $2');
      expect(sql.trimEnd().endsWith('ORDER BY created_at ASC')).toBe(true);
      expect(pool.query.mock.calls[0]![1]).toEqual(['s1', 5]);
    });
  });

  describe('rename', () => {
    it('marks the thread as human-titled so the auto-titler backs off', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ x: 1 }] }); // ownership
      pool.query.mockResolvedValueOnce({ rows: [{ id: 's1', title: 'Payroll questions' }] });

      const res = await store.renameSession({
        scope: 'tenant', tenantId: 't1', userId: 'u1',
        sessionId: '11111111-2222-3333-4444-555555555555', title: '  Payroll questions  ',
      });

      expect(res).toEqual({ id: 's1', title: 'Payroll questions' });
      expect(pool.query.mock.calls[1]![0]).toContain('auto_titled = false');
      expect(pool.query.mock.calls[1]![1]).toEqual(['11111111-2222-3333-4444-555555555555', 'Payroll questions']);
    });

    it('returns null instead of renaming another user’s thread', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await store.renameSession({
        scope: 'tenant', tenantId: 't1', userId: 'u1',
        sessionId: '11111111-2222-3333-4444-555555555555', title: 'Mine now',
      });

      expect(res).toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('archive', () => {
    it('soft-deletes so the transcript of real actions survives', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ x: 1 }] });
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await store.archiveSession({
        scope: 'tenant', tenantId: 't1', userId: 'u1',
        sessionId: '11111111-2222-3333-4444-555555555555',
      });

      const sql = pool.query.mock.calls[1]![0] as string;
      expect(sql).toContain('SET archived_at = NOW()');
      expect(sql).not.toContain('DELETE');
    });
  });

  describe('maybeAutoTitle', () => {
    const args = { sessionId: 's1', tenantId: 't1', userMessage: 'How much did we make today?', assistantReply: 'Rp 1.200.000' };

    it('names a fresh thread from the model', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ auto_titled: true, n: 1 }] });
      llm.chat.mockResolvedValueOnce({ content: '"Revenue today"' });
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      expect(await store.maybeAutoTitle(args)).toBe('Revenue today');
      expect(pool.query.mock.calls[1]![0]).toContain('auto_titled = true');
    });

    it('leaves a renamed thread alone', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ auto_titled: false, n: 1 }] });

      expect(await store.maybeAutoTitle(args)).toBeNull();
      expect(llm.chat).not.toHaveBeenCalled();
    });

    // One tiny completion per THREAD, not per message.
    it('does not re-title after the first turn', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ auto_titled: true, n: 4 }] });

      expect(await store.maybeAutoTitle(args)).toBeNull();
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it('falls back to the user’s own words when the model errors', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ auto_titled: true, n: 1 }] });
      llm.chat.mockResolvedValueOnce({ error: true, errorMessage: 'no key', content: '' });
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      expect(await store.maybeAutoTitle(args)).toBe('How much did we make today?');
    });

    it('never lets a title failure break the turn', async () => {
      pool.query.mockRejectedValueOnce(new Error('db down'));

      expect(await store.maybeAutoTitle(args)).toBeNull();
    });
  });
});

describe('cleanTitle', () => {
  it.each([
    ['"Revenue today"', 'Revenue today'],
    ['Title: Payroll run', 'Payroll run'],
    ['Membership renewals.', 'Membership renewals'],
    ['Stock levels\nand more prose', 'Stock levels'],
  ])('cleans %j', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  // When the model answers the question instead of naming it, we want the
  // fallback (the user's own words), not a paragraph in the sidebar.
  it('rejects a title long enough to be an answer', () => {
    expect(cleanTitle('x'.repeat(120))).toBe('');
  });

  it('rejects empty output', () => {
    expect(cleanTitle('   ')).toBe('');
  });
});

describe('truncateTitle', () => {
  it('collapses whitespace and keeps short text intact', () => {
    expect(truncateTitle('  how   is business \n today ')).toBe('how is business today');
  });

  it('ellipsizes at the limit', () => {
    const out = truncateTitle('a'.repeat(100));
    expect(out).toHaveLength(60);
    expect(out.endsWith('…')).toBe(true);
  });
});
