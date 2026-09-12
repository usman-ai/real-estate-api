import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ConvertLeadDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  propertyId!: number;

  @ApiProperty({ example: 456 })
  @IsInt()
  @Min(1)
  unitId!: number;

  @ApiPropertyOptional({ example: 'Customer agreed to proceed with the property', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
