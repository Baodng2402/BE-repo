import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class UpdateMemberDto {
  @ApiProperty({
    enum: MembershipRole,
    example: 'LEADER',
    description: 'New role for the member',
  })
  @IsEnum(MembershipRole, { message: 'Role must be MEMBER, LEADER, or MENTOR' })
  role_in_group: MembershipRole;
}
