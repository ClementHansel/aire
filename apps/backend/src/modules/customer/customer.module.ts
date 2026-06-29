import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, DatabasePoolProvider],
  exports: [CustomerService],
})
export class CustomerModule {}
