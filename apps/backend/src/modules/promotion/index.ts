import { Module } from '@nestjs/common';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [PromotionController],
  providers: [PromotionService, DatabasePoolProvider],
  exports: [PromotionService],
})
export class PromotionModule {}

export { PromotionService } from './promotion.service';
