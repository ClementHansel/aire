import { Module } from '@nestjs/common';
import { AgentConfigController } from './agent-config.controller';
import { AgentConfigService } from './agent-config.service';
import { KnowledgeDocsService } from './knowledge-docs.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [AgentConfigController],
  providers: [AgentConfigService, KnowledgeDocsService, DatabasePoolProvider],
  exports: [AgentConfigService, KnowledgeDocsService],
})
export class AgentConfigModule {}

export { AgentConfigService } from './agent-config.service';
export { KnowledgeDocsService } from './knowledge-docs.service';
export type { KnowledgeDocument } from './knowledge-docs.service';
