import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AgentRegistryService, UpsertAgentDto } from './agent-registry.service';

@Controller('api/agents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AgentRegistryController {
  constructor(private readonly service: AgentRegistryService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.list(user.tenant_id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: UpsertAgentDto) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpsertAgentDto) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JWTPayload, @Param('id') id: string): Promise<void> {
    return this.service.remove(user.tenant_id, id);
  }
}
