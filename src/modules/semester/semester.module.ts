import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Class,
  ClassMembership,
  ExaminerAssignment,
  Group,
  GroupMembership,
  GroupRepository,
  GroupReview,
  ImportBatch,
  ImportRowLog,
  Semester,
  SemesterWeekAuditLog,
  Task,
  TeachingAssignment,
  User,
} from '../../entities';
import { GithubModule } from '../github/github.module';
import { SemesterController } from './semester.controller';
import { SemesterGovernanceController } from './semester-governance.controller';
import { SemesterPublicController } from './semester-public.controller';
import { SemesterService } from './semester.service';

@Module({
  imports: [
    GithubModule,
    TypeOrmModule.forFeature([
      Semester,
      ImportBatch,
      ImportRowLog,
      Class,
      ClassMembership,
      TeachingAssignment,
      ExaminerAssignment,
      Group,
      GroupMembership,
      GroupRepository,
      GroupReview,
      SemesterWeekAuditLog,
      Task,
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
