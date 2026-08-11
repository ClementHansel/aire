'use client';

/**
 * Platform AI Console — the super-admin's cross-tenant analyst.
 *
 * Talks to /api/admin/ai/chat, whose tools read the control plane (tenants,
 * billing, ops feed, job heartbeats, AI usage) across every tenant. It is
 * deliberately READ-ONLY: suspending a tenant or editing an invoice stays a
 * human click on the matching admin page, where it is audited.
 */

import { AiChatWorkspace } from '@/components/shared/ai-chat/AiChatWorkspace';
import { PLATFORM_CHAT } from '@/components/shared/ai-chat/useAiChat';
import { useI18n } from '@/lib/i18n';

export default function AdminAssistantPage() {
  const { t } = useI18n();

  return (
    <AiChatWorkspace
      endpoints={PLATFORM_CHAT}
      testId="admin-assistant-page"
      title={t('admin.assistant.title', 'Airin AI Console')}
      subtitle={t(
        'admin.assistant.subtitle',
        'Ask about the platform across all tenants — growth, billing, incidents, jobs and AI usage. Read-only: it reports, you decide.',
      )}
      introTitle={t('admin.assistant.introTitle', 'Ask about the platform')}
      introBody={t(
        'admin.assistant.intro',
        'I can read tenant accounts, subscription billing, the ops event feed, background jobs and AI usage. Try one of these:',
      )}
      suggestions={[
        t('admin.assistant.suggestHealth', 'How is the platform doing this month?'),
        t('admin.assistant.suggestOverdue', 'Which tenants have overdue invoices?'),
        t('admin.assistant.suggestIncidents', 'What went wrong in the last 24 hours?'),
        t('admin.assistant.suggestJobs', 'Are any background jobs stale?'),
      ]}
      placeholder={t('admin.assistant.inputPlaceholder', 'Ask about tenants, billing, incidents…')}
      thinkingLabel={t('admin.assistant.thinking', 'Thinking…')}
      historyLabel={t('admin.assistant.history', 'Conversations')}
      newChatLabel={t('admin.assistant.newChat', 'New chat')}
      emptyHistoryLabel={t('admin.assistant.noHistory', 'No conversations yet.')}
    />
  );
}
