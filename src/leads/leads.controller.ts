import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';

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
}
