import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MePosController } from './me-pos.controller';
import { MeService } from './me.service';
import { HrModule } from '../hr/hr.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [HrModule],
  controllers: [MeController, MePosController],
  providers: [MeService, DatabasePoolProvider],
})
export class MeModule {}
