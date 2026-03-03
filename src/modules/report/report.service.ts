import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Groq from 'groq-sdk';
import { Repository } from 'typeorm';
import { Group } from '../../entities/group.entity';
import { ProjectLink } from '../../entities/project-link.entity';
import { GithubService } from '../github/github.service';
import { JiraService } from '../jira/jira.service';

@Injectable()
export class ReportService {
  private groq: Groq;

  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(ProjectLink)
    private readonly projectLinkRepository: Repository<ProjectLink>,
    private readonly jiraService: JiraService,
    private readonly githubService: GithubService,
  ) {
    // Ideally this comes from ConfigService.
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async generateSrs(
    groupId: string,
    userId: string,
  ): Promise<{ markdown: string }> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException('Group not found');

    const projectLink = await this.projectLinkRepository.findOne({
      where: { user_id: group.created_by_id },
    });
    if (!projectLink || !projectLink.jira_project_id) {
      throw new BadRequestException(
        'Group leader has not linked a Jira project yet',
      );
    }

    // 1. Fetch raw data from Jira
    const rawJiraData = await this.jiraService.getProjectIssues(
      group.created_by_id,
      projectLink.jira_project_id,
    );

    // 2. Synthesize input prompt
    const prompt = `You are a professional Business Analyst and System Architect. 
I have a list of Epics, User Stories, and Tasks extracted from a Jira project.
Please generate a comprehensive Software Requirements Specification (SRS) document using Markdown format.
Include sections like: 
1. Introduction (Purpose, Scope)
2. Overall Description (Product Perspective, Features)
3. Specific Requirements (Functional & Non-Functional based on the data below)
4. System Architecture (If any implies exist in tasks)

Raw Jira Data:
${JSON.stringify(rawJiraData)}

Return only the markdown document. Do not add conversational text around it.`;

    // 3. Request Markdown generation via Groq
    const chatCompletion = await this.groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-70b-8192',
      temperature: 0.5,
    });

    const markdownOutput =
      chatCompletion.choices[0]?.message?.content || '# Error generating SRS';

    return { markdown: markdownOutput };
  }

  async generateAssignmentReport(groupId: string, userId: string) {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['members', 'members.user'],
    });
    if (!group) throw new NotFoundException('Group not found');

    const projectLink = await this.projectLinkRepository.findOne({
      where: { user_id: group.created_by_id },
    });
    if (!projectLink || !projectLink.jira_project_id) {
      throw new BadRequestException(
        'Group leader has not linked a Jira project yet',
      );
    }

    const rawJiraData = await this.jiraService.getProjectIssues(
      group.created_by_id,
      projectLink.jira_project_id,
    );

    // Simplistic breakdown for frontend rendering
    const assignments = rawJiraData.map((issue: any) => ({
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      assignee: issue.assignee?.displayName || 'Unassigned',
      type: issue.issueType,
    }));

    return {
      groupName: group.name,
      totalTasks: assignments.length,
      assignments,
    };
  }

  async generateCommitReport(groupId: string, userId: string) {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['members', 'members.user'],
    });
    if (!group) throw new NotFoundException('Group not found');

    const projectLink = await this.projectLinkRepository.findOne({
      where: { user_id: group.created_by_id },
    });
    if (!projectLink || !projectLink.github_repo_full_name) {
      throw new BadRequestException(
        'Group leader has not linked a Github repository yet',
      );
    }

    const [owner, repo] = projectLink.github_repo_full_name.split('/');

    // Fetch directly from Github API wrapper
    const stats = await this.githubService.getRepoContributorsStats(
      group.created_by_id,
      owner,
      repo,
    );

    return {
      groupName: group.name,
      repository: projectLink.github_repo_full_name,
      contributors: stats,
    };
  }
}
