import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GroupMemberEntity {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  full_name: string;

  @ApiProperty({ example: 'studentA@fpt.edu.vn' })
  email: string;

  @ApiPropertyOptional({
    example: 'https://avatars.githubusercontent.com/u/1234',
  })
  avatar_url?: string;

  @ApiProperty({ example: 'LEADER', enum: ['MEMBER', 'LEADER', 'MENTOR'] })
  role_in_group: string;

  @ApiProperty({ example: '2025-09-01T00:00:00.000Z' })
  joined_at: Date;
}

export class GroupEntity {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Group Alpha' })
  name: string;

  @ApiPropertyOptional({ example: 'E-Commerce Platform' })
  project_name?: string;

  @ApiPropertyOptional({ example: 'Building a full-stack e-commerce platform' })
  description?: string;

  @ApiProperty({ example: 'HK2-2025' })
  semester?: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'ARCHIVED', 'COMPLETED'] })
  status: string;

  @ApiPropertyOptional({ example: 'https://github.com/org/repo' })
  github_repo_url?: string;

  @ApiPropertyOptional({ example: 'ECOM' })
  jira_project_key?: string;

  @ApiProperty({ example: 5 })
  members_count: number;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  created_by_id: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}

export class GroupDetailEntity extends GroupEntity {
  @ApiProperty({ type: [GroupMemberEntity] })
  members: GroupMemberEntity[];
}

export class PaginatedGroupsEntity {
  @ApiProperty({ type: [GroupEntity] })
  data: GroupEntity[];

  @ApiProperty({
    example: { total: 50, page: 1, limit: 20, total_pages: 3 },
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}
