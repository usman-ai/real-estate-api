import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadStateMachine } from './state-machine/lead-state-machine';
import { LeadAccessModule } from './policies/lead-access.module';
import { TimelineModule } from '../timeline/timeline.module';

@Module({
  imports: [TimelineModule, LeadAccessModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadStateMachine],
  exports: [LeadsService, LeadStateMachine],
})
export class LeadsModule {}
