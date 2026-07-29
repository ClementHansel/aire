import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [AIController],
  providers: [AIService, DatabasePoolProvider],
  exports: [AIService],
})
export class AIModule {}
