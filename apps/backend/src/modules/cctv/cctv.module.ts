import { Module } from '@nestjs/common';
import { CctvController } from './cctv.controller';
import { CctvService } from './cctv.service';

@Module({
  controllers: [CctvController],
  providers: [CctvService],
  exports: [CctvService],
})
export class CctvModule {}
