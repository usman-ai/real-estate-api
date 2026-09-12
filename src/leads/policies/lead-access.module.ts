import { Module } from '@nestjs/common';
import { LeadAccessPolicy } from './lead-access.policy';

/**
 * Small leaf module wrapping LeadAccessPolicy so both LeadsModule and
 * TimelineModule can inject it without importing each other (which would
 * introduce a cycle).
 */
@Module({
  providers: [LeadAccessPolicy],
  exports: [LeadAccessPolicy],
})
export class LeadAccessModule {}
