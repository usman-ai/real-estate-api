import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DroppedReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class DropLeadDto {
  @ApiProperty({ enum: DroppedReason, example: DroppedReason.BUDGET_ISSUE })
  @IsEnum(DroppedReason)
  reason!: DroppedReason;

  @ApiPropertyOptional({ example: 'Customer cannot increase the budget', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
