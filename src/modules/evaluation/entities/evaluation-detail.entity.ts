import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContributionDetail {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  user_id: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  full_name: string;

  @ApiPropertyOptional({ example: 'https://avatars.githubusercontent.com/...' })
  avatar_url: string | null;

  @ApiProperty({ example: 25.0 })
  contribution_percent: number;

  @ApiPropertyOptional({ example: 'Led backend work' })
  note: string | null;
}

export class EvaluationCreator {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Leader Name' })
  full_name: string;

  @ApiPropertyOptional({ example: 'https://avatars.githubusercontent.com/...' })
  avatar_url: string | null;
}

export class EvaluationDetailEntity {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  group_id: string;

  @ApiProperty({ example: 'Sprint 3 Evaluation' })
  title: string;

  @ApiPropertyOptional({ example: 'End of sprint contribution split' })
  description: string | null;

  @ApiProperty({ type: EvaluationCreator })
  created_by: EvaluationCreator;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  @ApiProperty({ type: [ContributionDetail] })
  contributions: ContributionDetail[];
}

export class MyContributionEntity {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  evaluation_id: string;

  @ApiProperty({ example: 'Sprint 3 Evaluation' })
  title: string;

  @ApiProperty({ example: 25.0 })
  contribution_percent: number;

  @ApiPropertyOptional({ example: 'Led backend work' })
  note: string | null;
}
