import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GroupStatus } from '@prisma/client';
import { CreateGroupDto } from './create-group.dto';

export class UpdateGroupDto extends PartialType(CreateGroupDto) {
  @ApiPropertyOptional({
    enum: GroupStatus,
    example: 'ACTIVE',
    description: 'Group status',
  })
  @IsEnum(GroupStatus, {
    message: 'Status must be ACTIVE, ARCHIVED, or COMPLETED',
  })
  @IsOptional()
  status?: GroupStatus;
}
