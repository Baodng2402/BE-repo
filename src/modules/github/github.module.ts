import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationToken } from '../../entities';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [TypeOrmModule.forFeature([IntegrationToken]), HttpModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
