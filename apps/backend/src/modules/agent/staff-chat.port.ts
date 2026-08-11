/**
 * The seam the WhatsApp module uses to reach the business chat agent.
 *
 * WhatsApp cannot import `AgentChatService` directly: that pulls in
 * `AgentService → AgentToolsService → NotificationService → WhatsappService`,
 * closing a runtime import cycle in which one of the classes is still
 * `undefined` when Nest reads the constructor metadata (the failure reads
 * "Nest can't resolve dependencies of the AgentChatService … index [1] appears
 * to be undefined at runtime"). Module-level `forwardRef` does not help there —
 * the problem is the FILE graph, not the module graph.
 *
 * So this file is deliberately a LEAF: a string token plus a structural type,
 * with no imports of its own. WhatsApp injects the token and type-imports the
 * interface (erased at compile time), so nothing in the agent chain is loaded
 * on its behalf. AgentModule binds the token to the real service with
 * `useExisting`, which keeps it the same singleton the dashboard chat uses.
 */

/** DI token for {@link StaffChatPort}. */
export const STAFF_CHAT = 'STAFF_CHAT';

export interface StaffChatTurn {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
  title?: string;
}

/** The one method WhatsApp needs: run a turn of the full business agent. */
export interface StaffChatPort {
  chat(
    tenantId: string,
    userId: string | null,
    outletId: string | null,
    sessionId: string | null,
    userMessage: string,
    options?: { readOnly?: boolean; surfaceNote?: string },
  ): Promise<StaffChatTurn>;
}
