import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AssignAgentDto {
  @ApiProperty({ example: 4, description: 'User id of an active AGENT' })
  @IsInt()
  @Min(1)
  agentId!: number;
}
