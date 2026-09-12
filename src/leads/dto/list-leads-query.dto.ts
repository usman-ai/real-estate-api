import { ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class ListLeadsQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    example: 4,
    description:
      'Filter by assignedAgentId. Always AND-ed with the caller\'s visibility ' +
      'scope, so an AGENT filtering by another AGENT\'s id gets [].',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  assignedAgentId?: number;
}
