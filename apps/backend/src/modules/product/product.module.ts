import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ServiceModule } from '../service';

/**
 * Products reuse ServiceService (products are stored as category='product'
 * services), so this module only adds the dedicated `/api/products` controller.
 */
@Module({
  imports: [ServiceModule],
  controllers: [ProductController],
})
export class ProductModule {}
