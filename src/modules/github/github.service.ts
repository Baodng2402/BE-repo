import { HttpService } from '@nestjs/axios';
import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { IntegrationProvider, IntegrationToken } from '../../entities';
import { createIntegrationException } from '../../common/errors/integration-error';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  updated_at: string;
}

interface GitHubContributorStats {
  author: {
    login: string;
    id: number;
    avatar_url: string;
    html_url: string;
  };
  total: number;
  weeks: {
    w: number;
    a: number;
    d: number;
    c: number;
  }[];
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author?: {
    login: string;
    id: number;
    avatar_url: string;
    html_url: string;
  };
}

@Injectable()
export class GithubService {
  constructor(
    @InjectRepository(IntegrationToken)
    private integrationTokenRepository: Repository<IntegrationToken>,
    private httpService: HttpService,
  ) {}

  private async getRequiredToken(userId: string) {
    const token = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.GITHUB },
    });

    if (!token || !token.access_token) {
      throw createIntegrationException(HttpStatus.BAD_REQUEST, {
        code: 'ACCOUNT_NOT_LINKED',
        provider: IntegrationProvider.GITHUB,
        message: 'GitHub account is not linked for this user.',
        reconnectRequired: true,
      });
    }

    return token;
  }

  private async mapGitHubError(
    error: any,
    userId: string,
    fallbackMessage: string,
  ): Promise<never> {
    const status = error?.response?.status;
    const remaining = error?.response?.headers?.['x-ratelimit-remaining'];

    if (status === 401) {
      await this.integrationTokenRepository.delete({
        user_id: userId,
        provider: IntegrationProvider.GITHUB,
      });
      throw createIntegrationException(HttpStatus.UNAUTHORIZED, {
        code: 'TOKEN_EXPIRED',
        provider: IntegrationProvider.GITHUB,
        message:
          'GitHub token expired or is no longer valid. Please reconnect GitHub.',
        reconnectRequired: true,
      });
    }

    if (status === 403 && `${remaining}` === '0') {
      throw createIntegrationException(HttpStatus.TOO_MANY_REQUESTS, {
        code: 'RATE_LIMITED',
        provider: IntegrationProvider.GITHUB,
        message:
          'GitHub rate limit reached. Please retry after the provider quota resets.',
        retryable: true,
      });
    }

    if (status === 403) {
      throw createIntegrationException(HttpStatus.FORBIDDEN, {
        code: 'INSUFFICIENT_SCOPE',
        provider: IntegrationProvider.GITHUB,
        message:
          'GitHub access is missing required permissions for this action. Please reconnect GitHub with the required scopes.',
        reconnectRequired: true,
      });
    }

    if (status === 404) {
      throw createIntegrationException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        provider: IntegrationProvider.GITHUB,
        message: 'The requested GitHub repository could not be found.',
      });
    }

    throw createIntegrationException(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_ERROR',
      provider: IntegrationProvider.GITHUB,
      message: fallbackMessage,
      details: {
        providerMessage:
          error?.response?.data?.message || error?.message || fallbackMessage,
      },
    });
  }

  async getUserRepositories(userId: string) {
    const token = await this.getRequiredToken(userId);

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
    } catch (error: any) {
      console.error('GitHub API error:', error.message);
      return this.mapGitHubError(
        error,
        userId,
        'Failed to fetch repositories from GitHub.',
      );
    }
  }
  async getRepoContributorsStats(userId: string, owner: string, repo: string) {
    const token = await this.getRequiredToken(userId);

    try {
      let statsResponse: GitHubContributorStats[] = [];
      let retries = 0;
      const maxRetries = 5;
      let exhaustedRetries = false;

      while (retries < maxRetries) {
        const response = await lastValueFrom(
          this.httpService.get<GitHubContributorStats[]>(
            `https://api.github.com/repos/${owner}/${repo}/stats/contributors`,
            {
              headers: {
                Authorization: `Bearer ${token.access_token}`,
                Accept: 'application/vnd.github.v3+json',
              },
            },
          ),
        );

        // GitHub API returns 202 if compiling stats. Wait with exponential backoff and retry.
        if (response.status === 202) {
          retries++;
          if (retries < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retries - 1), 16000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          continue;
        }

        statsResponse = Array.isArray(response.data) ? response.data : [];
        break;
      }

      if (retries >= maxRetries) {
        exhaustedRetries = true;
      }

      const contributors = statsResponse.map((stat) => {
        const totalAdditions = stat.weeks.reduce((sum, w) => sum + w.a, 0);
        const totalDeletions = stat.weeks.reduce((sum, w) => sum + w.d, 0);

        return {
          author: stat.author?.login || 'Unknown',
          developer_id: stat.author?.id,
          avatar_url: stat.author?.avatar_url,
          commits: stat.total,
          lines_added: totalAdditions,
          lines_deleted: totalDeletions,
          net_change: totalAdditions - totalDeletions,
        };
      });

      return { contributors, computing: exhaustedRetries };
    } catch (error: any) {
      console.error(
        `GitHub API error fetching stats for ${owner}/${repo}:`,
        error.message,
      );
      return this.mapGitHubError(
        error,
        userId,
        `Failed to fetch contributor stats for ${owner}/${repo}.`,
      );
    }
  }

  async getRepoCommits(userId: string, owner: string, repo: string) {
    const token = await this.getRequiredToken(userId);

    try {
      const response = await lastValueFrom(
        this.httpService.get<GitHubCommit[]>(
          `https://api.github.com/repos/${owner}/${repo}/commits`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.github.v3+json',
            },
            params: {
              per_page: 100, // Fetch up to 100 recent commits for the timeline
            },
          },
        ),
      );

      return response.data.map((item) => ({
        sha: item.sha,
        author: item.author?.login || item.commit.author.name,
        date: item.commit.author.date,
        message: item.commit.message,
        avatar_url: item.author?.avatar_url,
      }));
    } catch (error: any) {
      console.error(
        `GitHub API error fetching commits for ${owner}/${repo}:`,
        error.message,
      );
      return this.mapGitHubError(
        error,
        userId,
        `Failed to fetch commits for ${owner}/${repo}.`,
      );
    }
  }

  async createRepository(
    userId: string,
    repoName: string,
    description: string,
  ) {
    const token = await this.getRequiredToken(userId);

    try {
      const response = await lastValueFrom(
        this.httpService.post(
          'https://api.github.com/user/repos',
          {
            name: repoName,
            description,
            private: true,
            auto_init: true, // Generate a quick README
          },
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      console.error(
        'GitHub API error creating repository:',
        error?.response?.data || error.message,
      );
      return this.mapGitHubError(
        error,
        userId,
        'Failed to create repository on GitHub.',
      );
    }
  }

  async addCollaborator(
    userId: string,
    owner: string,
    repoName: string,
    targetGithubUsername: string,
  ) {
    const token = await this.getRequiredToken(userId);

    try {
      const response = await lastValueFrom(
        this.httpService.put(
          `https://api.github.com/repos/${owner}/${repoName}/collaborators/${targetGithubUsername}`,
          { permission: 'push' },
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        ),
      );
      return response.data;
    } catch (error: any) {
      console.error(
        'GitHub API error adding collaborator:',
        error?.response?.data || error.message,
      );
      // It's okay if it fails (maybe the user didn't exist or already invited)
      return null;
    }
  }

  async validateRepositoryAccess(userId: string, owner: string, repo: string) {
    const token = await this.getRequiredToken(userId);

    try {
      const response = await lastValueFrom(
        this.httpService.get<GitHubRepo>(
          `https://api.github.com/repos/${owner}/${repo}`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        ),
      );

      return {
        id: response.data.id,
        name: response.data.name,
        full_name: response.data.full_name,
        html_url: response.data.html_url,
        private: response.data.private,
      };
    } catch (error: any) {
      console.error(
        `GitHub API error validating repo access for ${owner}/${repo}:`,
        error?.response?.data || error.message,
      );
      return this.mapGitHubError(
        error,
        userId,
        `Failed to validate access to ${owner}/${repo}.`,
      );
    }
  }
}
