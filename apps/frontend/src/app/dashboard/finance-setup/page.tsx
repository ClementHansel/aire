'use client';

import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/dashboard/ui';
import { FinanceHrSetupStep } from '@/components/onboarding/FinanceHrSetupStep';

export default function FinanceSetupPage() {
  const { t } = useI18n();
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.financeSetup.title', 'Finance & Payroll Setup')}
        subtitle={t('dash.financeSetup.subtitle', 'Get your books and payroll running in one click, then let them run automatically. These settings also feed the onboarding wizard.')}
      />
      <FinanceHrSetupStep />
    </div>
  );
}
