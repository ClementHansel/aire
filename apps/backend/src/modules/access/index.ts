import { Module } from '@nestjs/common';
import { PermissionController, RoleController, UserController } from './access.controller';
import { AccessService } from './access.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [PermissionController, RoleController, UserController],
  providers: [AccessService, DatabasePoolProvider],
  exports: [AccessService],
})
export class AccessModule {}

export { AccessService } from './access.service';
