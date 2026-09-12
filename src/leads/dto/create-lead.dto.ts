import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadSource, PropertyType, Priority } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

// Deliberately lenient: accepts optional leading `+`, digits, spaces, dashes,
// parens. Strict per-country format is out of scope for the assessment.
const PHONE_REGEX = /^\+?[0-9][0-9\s()\-.]{5,25}$/;

export class CreateLeadDto {
  @ApiProperty({ example: 'Ahmed Ali' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '+97455555555' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone!: string;

  @ApiPropertyOptional({ example: '+97455555555' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'whatsappNumber must be a valid phone number' })
  whatsappNumber?: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: LeadSource, example: LeadSource.FACEBOOK })
  @IsEnum(LeadSource)
  source!: LeadSource;

  @ApiPropertyOptional({ example: 'West Bay Apartments' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  campaign?: string;

  @ApiPropertyOptional({ example: 'West Bay' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interestedLocation?: string;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

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

  @ApiPropertyOptional({ example: '2026-10-01', description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  movingDate?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({
    description:
      'Set true to acknowledge and bypass possible-duplicate detection when the same phone/whatsapp/email already exists.',
  })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
