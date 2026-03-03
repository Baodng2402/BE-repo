import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from '../../entities/group.entity';
import { ProjectLink } from '../../entities/project-link.entity';
import { GithubModule } from '../github/github.module';
import { JiraModule } from '../jira/jira.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Group, ProjectLink]),
    JiraModule,
    GithubModule,
  ],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
