import { Module } from '@nestjs/common';
import { DocTemplateController, PublicDocTemplateController } from './doc-template.controller';
import { DocTemplateService } from './doc-template.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [DocTemplateController, PublicDocTemplateController],
  providers: [DocTemplateService, DatabasePoolProvider],
  exports: [DocTemplateService],
})
export class DocTemplateModule {}
