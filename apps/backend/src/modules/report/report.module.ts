import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportPdfService } from './report-pdf.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [ReportController],
  providers: [ReportService, ReportPdfService, DatabasePoolProvider],
  exports: [ReportService],
})
export class ReportModule {}
