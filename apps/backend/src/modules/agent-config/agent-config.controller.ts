import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AgentConfigService, UpdateAgentConfigDto } from './agent-config.service';

@Controller('api/agent-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AgentConfigController {
  constructor(private readonly service: AgentConfigService) {}

  @Get()
  get(@CurrentUser() user: JWTPayload) {
    return this.service.get(user.tenant_id);
  }

  @Put()
  update(@CurrentUser() user: JWTPayload, @Body() dto: UpdateAgentConfigDto) {
    return this.service.update(user.tenant_id, dto);
  }
}
