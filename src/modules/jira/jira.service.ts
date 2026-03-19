import { HttpService } from '@nestjs/axios';
import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import {
  IntegrationProvider,
  IntegrationToken,
  ProjectLink,
} from '../../entities';
import { createIntegrationException } from '../../common/errors/integration-error';

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  simplified: boolean;
  style: string;
  isPrivate: boolean;
  avatarUrls: {
    '48x48': string;
    '24x24': string;
    '16x16': string;
    '32x32': string;
  };
}

@Injectable()
export class JiraService {
  constructor(
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @InjectRepository(ProjectLink)
    private readonly projectLinkRepository: Repository<ProjectLink>,
    private readonly httpService: HttpService,
  ) {}

  private async getRequiredToken(userId: string) {
    const token = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.JIRA },
    });

    if (!token || !token.access_token) {
      throw createIntegrationException(HttpStatus.BAD_REQUEST, {
        code: 'ACCOUNT_NOT_LINKED',
        provider: IntegrationProvider.JIRA,
        message: 'Jira account is not linked for this user.',
        reconnectRequired: true,
      });
    }

    return token;
  }

  private async mapJiraError(
    error: any,
    userId: string,
    fallbackMessage: string,
  ): Promise<never> {
    const status = error?.response?.status;

    if (status === 401) {
      await this.integrationTokenRepository.delete({
        user_id: userId,
        provider: IntegrationProvider.JIRA,
      });
      throw createIntegrationException(HttpStatus.UNAUTHORIZED, {
        code: 'TOKEN_EXPIRED',
        provider: IntegrationProvider.JIRA,
        message:
          'Jira token expired or is no longer valid. Please reconnect Jira.',
        reconnectRequired: true,
      });
    }

    if (status === 403) {
      throw createIntegrationException(HttpStatus.FORBIDDEN, {
        code: 'INSUFFICIENT_SCOPE',
        provider: IntegrationProvider.JIRA,
        message:
          'Jira access is missing required permissions for this action. Please reconnect Jira with the required scopes.',
        reconnectRequired: true,
      });
    }

    if (status === 404) {
      throw createIntegrationException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        provider: IntegrationProvider.JIRA,
        message: 'The requested Jira resource could not be found.',
      });
    }

    if (status === 429) {
      throw createIntegrationException(HttpStatus.TOO_MANY_REQUESTS, {
        code: 'RATE_LIMITED',
        provider: IntegrationProvider.JIRA,
        message:
          'Jira rate limit reached. Please retry after the provider quota resets.',
        retryable: true,
      });
    }

    throw createIntegrationException(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_ERROR',
      provider: IntegrationProvider.JIRA,
      message: fallbackMessage,
      details: {
        providerMessage:
          error?.response?.data?.errorMessages?.[0] ||
          error?.response?.data?.message ||
          error?.message ||
          fallbackMessage,
      },
    });
  }

  async getJiraCloudId(accessToken: string): Promise<string> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(
          'https://api.atlassian.com/oauth/token/accessible-resources',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
        ),
      );

      const resources = response.data;
      if (!resources || resources.length === 0) {
        throw new Error('No accessible Jira resources found for this token.');
      }

      // Typically you take the first one or allow user to select.
      // We will select the first available jira resource.
      const jiraResource = resources.find(
        (r: any) =>
          r.scopes.includes('read:jira-work') ||
          r.scopes.includes('read:jira-user'),
      );

      if (!jiraResource && resources.length > 0) {
        // If none specifically have the scope array we expect, just use the first id.
        return resources[0].id;
      }
      return jiraResource ? jiraResource.id : resources[0].id;
    } catch (error: any) {
      console.error('Failed to get Jira Cloud ID:', error.message);
      throw createIntegrationException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_ERROR',
        provider: IntegrationProvider.JIRA,
        message: 'Could not connect to Atlassian to resolve Jira site ID.',
        details: {
          providerMessage: error?.response?.data?.message || error?.message,
        },
      });
    }
  }

  async getProjects(userId: string): Promise<JiraProject[]> {
    const token = await this.getRequiredToken(userId);

    try {
      // 1. Get the Cloud ID for the user's Atlassian site
      const cloudId = await this.getJiraCloudId(token.access_token);

      // 2. Fetch the projects for that site
      const response = await lastValueFrom(
        this.httpService.get<{ values: JiraProject[] }>(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/json',
            },
            params: {
              maxResults: 50,
            },
          },
        ),
      );

      return response.data.values || [];
    } catch (error: any) {
      console.error('Jira API error fetching projects:', error.message);
      return this.mapJiraError(error, userId, 'Failed to fetch Jira projects.');
    }
  }

  async getProjectIssues(userId: string, projectId: string): Promise<any[]> {
    const token = await this.getRequiredToken(userId);

    try {
      const cloudId = await this.getJiraCloudId(token.access_token);

      // Perform a JQL search to pull issues belonging to this project
      const response = await lastValueFrom(
        this.httpService.get(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/json',
            },
            params: {
              jql: `project = "${projectId}"`,
              maxResults: 100,
            },
          },
        ),
      );

      const issues = response.data.issues || [];
      return issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        assignee: issue.fields?.assignee,
        issueType: issue.fields?.issuetype?.name,
      }));
    } catch (error: any) {
      console.error('Jira API error fetching project issues:', error.message);
      return this.mapJiraError(
        error,
        userId,
        `Failed to fetch Jira issues for project ${projectId}.`,
      );
    }
  }

  async linkProject(
    userId: string,
    githubRepoFullName: string,
    jiraProjectId: string,
  ) {
    // Check if the link already exists
    const existingLink = await this.projectLinkRepository.findOne({
      where: {
        user_id: userId,
        github_repo_full_name: githubRepoFullName,
      },
    });

    if (existingLink) {
      // Update existing link
      existingLink.jira_project_id = jiraProjectId;
      await this.projectLinkRepository.save(existingLink);
      return existingLink;
    }

    // Create new link
    const newLink = this.projectLinkRepository.create({
      user_id: userId,
      github_repo_full_name: githubRepoFullName,
      jira_project_id: jiraProjectId,
    });

    return this.projectLinkRepository.save(newLink);
  }

  async createProject(userId: string, projectName: string, projectKey: string) {
    const token = await this.getRequiredToken(userId);

    try {
      const cloudId = await this.getJiraCloudId(token.access_token);

      // Get user's account ID from Jira to assign as lead
      const meResponse = await lastValueFrom(
        this.httpService.get(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/json',
            },
          },
        ),
      );
      const leadAccountId = meResponse.data.accountId;

      const response = await lastValueFrom(
        this.httpService.post(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`,
          {
            key: projectKey.substring(0, 10).toUpperCase(), // Jira keys must be short and uppercase
            name: projectName,
            projectTypeKey: 'software',
            projectTemplateKey:
              'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
            description: 'Created automatically by the Group Management System',
            leadAccountId: leadAccountId,
          },
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      console.error(
        'Jira API error creating project:',
        error?.response?.data || error.message,
      );
      return this.mapJiraError(error, userId, 'Failed to create Jira project.');
    }
  }

  async validateProjectAccess(userId: string, projectKey: string) {
    const token = await this.getRequiredToken(userId);

    try {
      const cloudId = await this.getJiraCloudId(token.access_token);
      const response = await lastValueFrom(
        this.httpService.get<JiraProject>(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(projectKey)}`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/json',
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      console.error(
        `Jira API error validating project key ${projectKey}:`,
        error?.response?.data || error.message,
      );
      return this.mapJiraError(
        error,
        userId,
        `Failed to validate Jira project key ${projectKey}.`,
      );
    }
  }
}
