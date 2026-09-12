import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotQualifiedReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkNotQualifiedDto {
  @ApiProperty({ enum: NotQualifiedReason, example: NotQualifiedReason.BUDGET_NOT_SUITABLE })
  @IsEnum(NotQualifiedReason)
  reason!: NotQualifiedReason;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
