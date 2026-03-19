import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Class,
  ClassMembership,
  Group,
  ImportBatch,
  ImportRowLog,
  Semester,
  User,
} from '../../entities';
import { SemesterController } from './semester.controller';
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
      User,
    ]),
  ],
  controllers: [SemesterController],
  providers: [SemesterService],
  exports: [SemesterService],
})
export class SemesterModule {}

