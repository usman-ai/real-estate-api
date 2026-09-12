import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class QualifyDto {
  @ApiPropertyOptional({ example: 'Customer requires a 2-bedroom apartment in West Bay' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  qualificationComment?: string;

  @ApiPropertyOptional({ example: 'West Bay' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interestedLocation?: string;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetFrom?: number;

  @ApiPropertyOptional({ example: 8000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetTo?: number;
}
