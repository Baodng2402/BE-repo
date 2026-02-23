import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID to add to the group',
  })
  @IsUUID('4', { message: 'user_id must be a valid UUID' })
  @IsNotEmpty()
  user_id: string;

  @ApiPropertyOptional({
    enum: MembershipRole,
    example: 'MEMBER',
    description: 'Role in group (defaults to MEMBER)',
  })
  @IsEnum(MembershipRole, { message: 'Role must be MEMBER, LEADER, or MENTOR' })
  @IsOptional()
  role_in_group?: MembershipRole;
}
