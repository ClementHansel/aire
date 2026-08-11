'use client';

/**
 * AI Assistant — the tenant's conversational co-pilot.
 *
 * Chats with the configured LLM via /api/agent/chat: the assistant reads live
 * business data through tools and can operate the app through governed ones.
 * Threads (history, rename, pin, delete) are shared with the floating mini chat
 * in the dashboard shell — same conversations, two places to have them.
 */

import { AiChatWorkspace } from '@/components/shared/ai-chat/AiChatWorkspace';
import { TENANT_CHAT } from '@/components/shared/ai-chat/useAiChat';
import { useI18n } from '@/lib/i18n';

export default function AssistantPage() {
  const { t } = useI18n();

  return (
    <AiChatWorkspace
      endpoints={TENANT_CHAT}
      testId="assistant-page"
      title={t('dash.assistant.title', 'Airin AI Assistant')}
      subtitle={t(
        'dash.assistant.subtitle',
        'Ask about your business or tell the assistant what to automate. It reads live data and can act through governed tools.',
      )}
      introTitle={t('dash.assistant.introTitle', 'Ask me about your business')}
      introBody={t(
        'dash.assistant.intro',
        'I can see your orders, revenue, memberships, queue, and recent activity. Try one of these:',
      )}
      suggestions={[
        t('dash.assistant.suggestBusiness', 'How is business doing today?'),
        t('dash.assistant.suggestExpiring', 'Which memberships expire in the next 30 days?'),
        t('dash.assistant.suggestOrders', 'Show me the last 10 orders'),
        t('dash.assistant.suggestLastHour', 'What happened in the last hour?'),
      ]}
      placeholder={t('dash.assistant.inputPlaceholder', 'Ask the assistant…')}
      thinkingLabel={t('dash.assistant.thinking', 'Thinking…')}
      historyLabel={t('dash.assistant.history', 'Conversations')}
      newChatLabel={t('dash.assistant.newChat', 'New chat')}
      emptyHistoryLabel={t('dash.assistant.noHistory', 'No conversations yet.')}
    />
  );
}
