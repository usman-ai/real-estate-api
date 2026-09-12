import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get(':id/timeline')
  @ApiOperation({
    summary: "Get a lead's timeline (audit trail)",
    description:
      'Chronological (occurredAt ASC) list of every audit event for the lead. ' +
      'Retained after the lead is CLOSED. An AGENT sees only their own assigned ' +
      "leads' timelines; other leads return 404.",
  })
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.timeline.getForLead(id, user);
  }
}
