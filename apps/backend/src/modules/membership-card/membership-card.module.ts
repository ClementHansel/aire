import { Module } from '@nestjs/common';
import { MembershipCardController, PublicMembershipCardController } from './membership-card.controller';
import { MembershipCardService } from './membership-card.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [MembershipCardController, PublicMembershipCardController],
  providers: [MembershipCardService, DatabasePoolProvider],
  exports: [MembershipCardService],
})
export class MembershipCardModule {}
