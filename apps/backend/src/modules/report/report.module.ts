import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportPdfService } from './report-pdf.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { DocTemplateModule } from '../doc-template/doc-template.module';
import { BrandingModule } from '../branding/branding.module';

@Module({
  imports: [DocTemplateModule, BrandingModule],
  controllers: [ReportController],
  providers: [ReportService, ReportPdfService, DatabasePoolProvider],
  exports: [ReportService],
})
export class ReportModule {}
