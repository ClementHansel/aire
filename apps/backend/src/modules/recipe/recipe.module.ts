import { Module } from '@nestjs/common';
import { RecipeController } from './recipe.controller';
import { RecipeService } from './recipe.service';
import { OpnameController } from './opname.controller';
import { OpnameService } from './opname.service';
import { CogsReportController } from './cogs-report.controller';
import { CogsReportService } from './cogs-report.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/** COGS domain: recipes/BOM, cost components, UOM, stock opname, and P&L/variance reports. */
@Module({
  controllers: [RecipeController, OpnameController, CogsReportController],
  providers: [RecipeService, OpnameService, CogsReportService, DatabasePoolProvider],
  exports: [RecipeService, OpnameService, CogsReportService],
})
export class RecipeModule {}
