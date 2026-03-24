import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Evaluation,
  EvaluationContribution,
  Group,
  GroupMembership,
} from '../../entities';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evaluation,
      EvaluationContribution,
      Group,
      GroupMembership,
    ]),
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
