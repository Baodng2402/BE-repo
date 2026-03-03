import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import {
  IntegrationProvider,
  IntegrationToken,
  ProjectLink,
} from '../../entities';

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
      throw new BadRequestException(
        'Could not connect to Atlassian to resolve Site ID',
      );
    }
  }

  async getProjects(userId: string): Promise<JiraProject[]> {
    const token = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.JIRA },
    });

    if (!token || !token.access_token) {
      throw new BadRequestException('Jira account is not linked for this user');
    }

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
      if (error.response?.status === 401 || error.response?.status === 403) {
        await this.integrationTokenRepository.delete({
          user_id: userId,
          provider: IntegrationProvider.JIRA,
        });
        throw new BadRequestException(
          'Jira token expired or invalid. Please re-link your Atlassian account.',
        );
      }
      throw new BadRequestException('Failed to fetch Jira projects');
    }
  }

  async getProjectIssues(userId: string, projectId: string): Promise<any[]> {
    const token = await this.integrationTokenRepository.findOne({
      where: { user_id: userId, provider: IntegrationProvider.JIRA },
    });

    if (!token || !token.access_token) {
      throw new BadRequestException('Jira account is not linked for this user');
    }

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
      throw new BadRequestException('Failed to fetch Jira project issues');
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
}
