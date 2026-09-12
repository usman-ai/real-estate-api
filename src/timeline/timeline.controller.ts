import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';

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
      'Retained after the lead is CLOSED. Per-lead visibility filtering is added ' +
      'in the next phase — for now any authenticated user may read any timeline.',
  })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.timeline.getForLead(id);
  }
}
