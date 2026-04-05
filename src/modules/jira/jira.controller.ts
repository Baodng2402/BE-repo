import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthorizedRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JiraProject } from './jira.service';
import { JiraService } from './jira.service';

export class LinkProjectDto {
  github_repo_full_name: string;
  jira_project_id: string;
}

@ApiTags('Jira')
@Controller('jira')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @Get('projects')
  @ApiOperation({ summary: 'Get accessible Jira projects for the user' })
  @ApiResponse({ status: 200, description: 'List of Jira projects' })
  async getProjects(@Req() req: AuthorizedRequest): Promise<JiraProject[]> {
    return this.jiraService.getProjects(req.user.id);
  }

  @Get('projects/:projectKey/access')
  @ApiOperation({
    summary: 'Check if the current user has access to a Jira project',
  })
  @ApiParam({ name: 'projectKey', example: 'SCRUM' })
  @ApiResponse({
    status: 200,
    description:
      '{ has_access: true } if accessible, { has_access: false } otherwise',
  })
  async checkProjectAccess(
    @Req() req: AuthorizedRequest,
    @Param('projectKey') projectKey: string,
  ): Promise<{ has_access: boolean }> {
    return this.jiraService.checkProjectAccess(req.user.id, projectKey);
  }

  @Get('projects/:projectKey/assignable')
  @ApiOperation({
    summary:
      'Check if the current user is assignable (explicit project member) in a Jira project',
  })
  @ApiParam({ name: 'projectKey', example: 'SCRUM' })
  @ApiResponse({
    status: 200,
    description:
      '{ assignable: true } if user can be assigned issues, { assignable: false } otherwise',
  })
  async checkAssignable(
    @Req() req: AuthorizedRequest,
    @Param('projectKey') projectKey: string,
  ): Promise<{ assignable: boolean }> {
    return this.jiraService.isAssignableInProject(req.user.id, projectKey);
  }

  @Post('projects/link')
  @ApiOperation({ summary: 'Link a GitHub repository to a Jira project' })
  @ApiResponse({ status: 201, description: 'Project linked successfully' })
  async linkProject(
    @Req() req: AuthorizedRequest,
    @Body() dto: LinkProjectDto,
  ) {
    return await this.jiraService.linkProject(
      req.user.id,
      dto.github_repo_full_name,
      dto.jira_project_id,
    );
  }
}
