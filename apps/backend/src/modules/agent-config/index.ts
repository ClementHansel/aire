import { Module } from '@nestjs/common';
import { AgentConfigController } from './agent-config.controller';
import { AgentConfigService } from './agent-config.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [AgentConfigController],
  providers: [AgentConfigService, DatabasePoolProvider],
  exports: [AgentConfigService],
})
export class AgentConfigModule {}

export { AgentConfigService } from './agent-config.service';
