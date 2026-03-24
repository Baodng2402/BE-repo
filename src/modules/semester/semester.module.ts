import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Class,
  ClassMembership,
  Group,
  GroupMembership,
  ImportBatch,
  ImportRowLog,
  Semester,
  SemesterWeekAuditLog,
  User,
} from '../../entities';
import { SemesterController } from './semester.controller';
import { SemesterGovernanceController } from './semester-governance.controller';
import { SemesterPublicController } from './semester-public.controller';
import { SemesterService } from './semester.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Semester,
      ImportBatch,
      ImportRowLog,
      Class,
      ClassMembership,
      Group,
      GroupMembership,
      SemesterWeekAuditLog,
      User,
    ]),
  ],
  controllers: [
    SemesterController,
    SemesterPublicController,
    SemesterGovernanceController,
  ],
  providers: [SemesterService],
  exports: [SemesterService],
})
export class SemesterModule {}
