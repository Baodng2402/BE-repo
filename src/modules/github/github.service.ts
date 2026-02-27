import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { IntegrationProvider, IntegrationToken } from '../../entities';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  updated_at: string;
}

@Injectable()
export class GithubService {
  constructor(
    @InjectRepository(IntegrationToken)
    private integrationTokenRepository: Repository<IntegrationToken>,
    private httpService: HttpService,
  ) {}

  async getUserRepositories(userId: string) {
    const token = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.GITHUB },
    });

    if (!token || !token.access_token) {
      throw new BadRequestException(
        'GitHub account is not linked for this user',
      );
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get<GitHubRepo[]>(
          'https://api.github.com/user/repos',
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.github.v3+json',
            },
            params: {
              per_page: 100,
              sort: 'updated',
            },
          },
        ),
      );

      const repos = response.data;
      return {
        total_repos: repos.length,
        repositories: repos.map((r) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          html_url: r.html_url,
          updated_at: r.updated_at,
        })),
      };
    } catch (error) {
      console.error('GitHub API error:', error);
      throw new BadRequestException(
        'Failed to fetch repositories from GitHub APIs',
      );
    }
  }
}
