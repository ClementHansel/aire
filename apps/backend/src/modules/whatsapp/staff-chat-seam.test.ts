import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAFF_CHAT } from '../agent/staff-chat.port';

/**
 * Guards the seam WhatsApp uses to reach the business chat agent.
 *
 * This exists because the obvious code — `import { AgentChatService }` in
 * `whatsapp.service.ts` — builds, typechecks and passes every unit test, then
 * fails at BOOT with "the dependency at index [1] appears to be undefined at
 * runtime". It closes a runtime import cycle:
 *
 *   whatsapp.service → agent-chat.service → agent.service → agent-tools.service
 *   → notification.service → whatsapp.service
 *
 * Nothing in a mock-based test can see that, so the check is structural: assert
 * WhatsApp reaches the agent only through the import-free port, and that the
 * port file stays import-free.
 */
const here = (p: string) => join(__dirname, p);
const read = (p: string) => readFileSync(here(p), 'utf8');

/** Runtime (value) imports only — `import type` / `type X` are erased. */
function runtimeImportSources(src: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?!type\s)([\s\S]*?)from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const clause = m[1] ?? '';
    // `import { type A, type B } from 'x'` is fully erased too.
    const names = clause.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean);
    const allTypeOnly = names.length > 0 && names.every((n) => n.startsWith('type '));
    if (!allTypeOnly) out.push(m[2]!);
  }
  return out;
}

describe('WhatsApp → chat-agent seam', () => {
  it('does not import the agent chat/service classes at runtime', () => {
    const sources = runtimeImportSources(read('whatsapp.service.ts'));

    const offenders = sources.filter((s) => /^\.\.\/agent\/(agent-chat\.service|agent\.service|agent-tools\.service)$/.test(s));
    expect(offenders).toEqual([]);
  });

  it('reaches the agent through the port token instead', () => {
    const src = read('whatsapp.service.ts');

    expect(src).toContain("from '../agent/staff-chat.port'");
    expect(src).toContain('@Inject(STAFF_CHAT)');
    expect(STAFF_CHAT).toBe('STAFF_CHAT');
  });

  it('keeps the port file a leaf — no runtime imports at all', () => {
    // The moment this file imports something, it can be dragged back into the
    // cycle it exists to avoid.
    expect(runtimeImportSources(read('../agent/staff-chat.port.ts'))).toEqual([]);
  });

  it('binds the token to the real service in AgentModule', () => {
    const src = read('../agent/agent.module.ts');

    expect(src).toContain('provide: STAFF_CHAT');
    // `useExisting`, not `useClass`: the WhatsApp path must share the dashboard's
    // singleton rather than get a second instance of the agent.
    expect(src).toMatch(/provide:\s*STAFF_CHAT,\s*useExisting:\s*AgentChatService/);
    expect(src).toContain('STAFF_CHAT],');
  });

  it('forwardRefs AgentModule, because the module graph is cyclic too', () => {
    expect(read('index.ts')).toContain('forwardRef(() => AgentModule)');
  });
});
