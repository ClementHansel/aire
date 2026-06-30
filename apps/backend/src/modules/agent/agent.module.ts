import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ProposalService } from './proposal.service';
import { LLMRouterService } from './llm-router.service';
import { AgentGateway } from './agent.gateway';
import { SchedulerService } from './scheduler.service';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentChatService } from './agent-chat.service';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { SalesModule } from '../sales/sales.module';
import { HrModule } from '../hr/hr.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * AI Agent Module.
 *
 * Provides the AI agent framework with tool registry, tool execution,
 * action proposals, LLM routing, WebSocket gateway for real-time
 * proposal notifications, and scheduled analysis capabilities.
 *
 * Requirements: 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.2, 8.3, 8.4, 8.5
 */
@Module({
  imports: [SettingsModule, AuditModule, NotificationModule, InventoryModule, FinanceModule, SalesModule, HrModule, ProcurementModule],
  controllers: [AgentController],
  providers: [AgentService, ProposalService, LLMRouterService, AgentGateway, SchedulerService, ScheduledAnalysisService, AgentToolsService, AgentChatService, DatabasePoolProvider],
  exports: [AgentService, ProposalService, LLMRouterService, AgentGateway, SchedulerService, ScheduledAnalysisService, AgentToolsService, AgentChatService],
})
export class AgentModule {}
