import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GithubService } from './github.service';

@ApiTags('GitHub')
@Controller('github')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Get('repos')
  @ApiOperation({ summary: 'Get total repositories of linked GitHub account' })
  @ApiResponse({
    status: 200,
    description: 'Returns repository count and details',
  })
  @ApiResponse({ status: 400, description: 'GitHub account is not linked' })
  async getRepos(@Req() req: AuthorizedRequest) {
    return this.githubService.getUserRepositories(req.user.id);
  }

  @Get('repos/:owner/:repo/contributors-stats')
  @ApiOperation({ summary: 'Get total commits and LOC changes per developer' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of contributors with stats',
  })
  async getContributorsStats(
    @Req() req: AuthorizedRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.getRepoContributorsStats(
      req.user.id,
      owner,
      repo,
    );
  }

  @Get('repos/:owner/:repo/commits')
  @ApiOperation({ summary: 'Get commit history for a repository' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of recent commits',
  })
  async getCommits(
    @Req() req: AuthorizedRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.getRepoCommits(req.user.id, owner, repo);
  }
}
