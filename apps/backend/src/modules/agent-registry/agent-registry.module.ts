import { Module } from '@nestjs/common';
import { AgentRegistryController } from './agent-registry.controller';
import { AgentRegistryService } from './agent-registry.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [AgentRegistryController],
  providers: [AgentRegistryService, DatabasePoolProvider],
  exports: [AgentRegistryService],
})
export class AgentRegistryModule {}
