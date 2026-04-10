import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from '../../entities/group.entity';
import { GroupMembership } from '../../entities/group-membership.entity';
import { SrsDocument } from '../../entities/srs-document.entity';
import { SrsVersion } from '../../entities/srs-version.entity';
import { ReportModule } from '../report/report.module';
import { SrsController } from './srs.controller';
import { SrsService } from './srs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SrsDocument, SrsVersion, GroupMembership, Group]),
    ReportModule,
  ],
  controllers: [SrsController],
  providers: [SrsService],
})
export class SrsModule {}
