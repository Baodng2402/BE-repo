import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { GroupStatus } from '../../../entities';
import { CreateGroupDto } from './create-group.dto';

export class UpdateGroupDto extends PartialType(
  OmitType(CreateGroupDto, ['class_id'] as const),
) {
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

  @ApiPropertyOptional({
    description: 'Topic UUID',
  })
  @IsOptional()
  topic_id?: string;

  @ApiPropertyOptional({
    description: 'GitHub repository URL to link to this group',
  })
  @IsOptional()
  github_repo_url?: string;
}
