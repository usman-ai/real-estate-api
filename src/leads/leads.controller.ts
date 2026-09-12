import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { QualifyDto } from './dto/qualify.dto';
import { MarkNotQualifiedDto } from './dto/mark-not-qualified.dto';
import { AssignAgentDto } from './dto/assign-agent.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { DropLeadDto } from './dto/drop-lead.dto';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @Roles(Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new lead',
    description:
      'Duplicate check runs on phone/whatsappNumber/email (email case-insensitive). ' +
      'A 409 POSSIBLE_DUPLICATE response includes existingLeadIds; re-post with ' +
      '`confirmDuplicate: true` in the body to create anyway.',
  })
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.create(dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'List leads visible to the caller',
    description:
      'AGENT sees only leads assigned to themselves; every other role sees all. ' +
      'Hard-capped at 100 rows in this phase; filters (?status, ?assignedAgentId) ' +
      'land in the next phase.',
  })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.findAll(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single lead',
    description:
      'Returns 404 (not 403) when the caller is not permitted to see the lead ' +
      'so unprivileged callers cannot enumerate IDs from status codes.',
  })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.findOne(id, user);
  }

  @Post(':id/pickup')
  @Roles(Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pick up a NEW lead for follow-up (starts qualification)',
    description: 'NEW → LEAD_GENERATION_FOLLOW_UP. Emits QUALIFICATION_STARTED.',
  })
  pickup(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.pickup(id, user);
  }

  @Post(':id/qualify')
  @Roles(Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Qualify a lead',
    description:
      'Atomically transitions LEAD_GENERATION_FOLLOW_UP → QUALIFIED → ' +
      'PENDING_AGENT_ASSIGNMENT and emits both LEAD_QUALIFIED and ' +
      'PENDING_AGENT_ASSIGNMENT audit events.',
  })
  qualify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QualifyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.qualify(id, user, dto);
  }

  @Post(':id/not-qualified')
  @Roles(Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a lead as NOT_QUALIFIED (terminal)',
    description:
      'LEAD_GENERATION_FOLLOW_UP → NOT_QUALIFIED. Requires a reason from the ' +
      'NotQualifiedReason enum; comment is optional. Lead history is retained.',
  })
  markNotQualified(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkNotQualifiedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.markNotQualified(id, user, dto);
  }

  @Post(':id/assign')
  @Roles(Role.AGENT_SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign or reassign a lead to an agent',
    description:
      'PENDING_AGENT_ASSIGNMENT → AGENT_ASSIGNED (first assignment), or ' +
      'AGENT_ASSIGNED → AGENT_ASSIGNED (reassignment). The endpoint auto-detects ' +
      'and emits AGENT_ASSIGNED or AGENT_REASSIGNED accordingly. Rejects agentId ' +
      'that is not an active user with role=AGENT.',
  })
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignAgentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.assign(id, user, dto);
  }

  @Post(':id/convert')
  @Roles(Role.AGENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a lead as converted (pending approval)',
    description:
      'AGENT_ASSIGNED → CONVERTED_PENDING_APPROVAL. Only the assigned agent may ' +
      'call this; another AGENT gets 403 LEAD_NOT_ACCESSIBLE.',
  })
  convert(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.convert(id, user, dto);
  }

  @Post(':id/drop')
  @Roles(Role.AGENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a lead as dropped (pending approval)',
    description:
      'AGENT_ASSIGNED → DROPPED_PENDING_APPROVAL. Only the assigned agent may ' +
      'call this; another AGENT gets 403 LEAD_NOT_ACCESSIBLE.',
  })
  drop(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DropLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.drop(id, user, dto);
  }

  @Post(':id/approve')
  @Roles(Role.LEAD_GENERATION_SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending outcome (CONVERTED or DROPPED) and close the lead',
    description:
      '{CONVERTED,DROPPED}_PENDING_APPROVAL → CLOSED. Emits OUTCOME_APPROVED and ' +
      'LEAD_CLOSED. History is retained after close.',
  })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.approve(id, user);
  }
}
