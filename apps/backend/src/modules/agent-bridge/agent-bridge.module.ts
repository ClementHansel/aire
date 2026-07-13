import { Module } from '@nestjs/common';
import { BridgeController } from './bridge.controller';
import { AgentFlowAdminController, AgentFlowSelectionController } from './agent-flow.controller';
import { AgentFlowService } from './agent-flow.service';
import { BridgeTokenGuard } from './bridge-token.guard';
import { DatabasePoolProvider } from '../auth/database.provider';
import { WhatsappModule } from '../whatsapp';
import { AgentModule } from '../agent';

/**
 * Agent Bridge Module — integration layer for the hosted n8n agent builder.
 *
 *  - BridgeController: token-authenticated endpoints n8n calls back into
 *    (scoped context, tenant-keyed LLM, gated tools, WhatsApp send).
 *  - AgentFlow*Controller: super-admin flow catalog + tenant flow selection.
 *
 * Depends on WhatsappModule (CustomerContextService, WhatsappService) and
 * AgentModule (AgentService, LLMRouterService). Nothing here is imported by
 * WhatsappModule, so the inbound dispatch seam stays cycle-free.
 */
@Module({
  imports: [WhatsappModule, AgentModule],
  controllers: [BridgeController, AgentFlowAdminController, AgentFlowSelectionController],
  providers: [AgentFlowService, BridgeTokenGuard, DatabasePoolProvider],
  exports: [AgentFlowService],
})
export class AgentBridgeModule {}
