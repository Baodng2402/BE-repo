import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import {
  IntegrationProvider,
  IntegrationToken,
  ProjectLink,
} from '../../entities';
import { JiraService } from './jira.service';

describe('JiraService', () => {
  let service: JiraService;
  let integrationTokenRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let projectLinkRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let httpService: {
    get: jest.Mock;
    post: jest.Mock;
    axiosRef: {
      get: jest.Mock;
      post: jest.Mock;
    };
  };
  let configService: {
    get: jest.Mock;
  };

  const jiraToken: IntegrationToken = {
    id: 'token-1',
    user_id: 'user-1',
    provider: IntegrationProvider.JIRA,
    provider_user_id: 'jira-user-1',
    provider_username: 'jira-user',
    provider_email: 'jira@example.com',
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token',
    token_expires_at: new Date(Date.now() - 60_000),
    scope: 'read:jira-work offline_access',
    used_for_login: true,
    created_at: new Date('2026-03-20T10:00:00.000Z'),
    updated_at: new Date('2026-03-20T10:00:00.000Z'),
    last_refreshed_at: new Date('2026-03-20T10:00:00.000Z'),
    user: undefined as any,
  };

  beforeEach(async () => {
    integrationTokenRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
    };
    projectLinkRepository = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    httpService = {
      get: jest.fn(),
      post: jest.fn(),
      axiosRef: {
        get: jest.fn(),
        post: jest.fn(),
      },
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JIRA_CLIENT_ID') return 'jira-client-id';
        if (key === 'JIRA_CLIENT_SECRET') return 'jira-client-secret';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraService,
        {
          provide: getRepositoryToken(IntegrationToken),
          useValue: integrationTokenRepository,
        },
        {
          provide: getRepositoryToken(ProjectLink),
          useValue: projectLinkRepository,
        },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<JiraService>(JiraService);
  });

  it('refreshes Jira token once and retries the failed project fetch', async () => {
    integrationTokenRepository.findOne.mockResolvedValue(jiraToken);
    httpService.axiosRef.post.mockResolvedValue({
      data: {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        scope: 'read:jira-work offline_access',
      },
    });
    httpService.axiosRef.get.mockResolvedValue({
      data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
    });
    httpService.get
      .mockReturnValueOnce(
        throwError(() => ({
          response: { status: 401, data: { message: 'expired' } },
        })),
      )
      .mockReturnValueOnce(
        of({
          data: {
            values: [
              {
                id: '10001',
                key: 'SWP',
                name: 'SWP Project',
              },
            ],
          },
        }),
      );

    const result = await service.getProjects('user-1');

    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://auth.atlassian.com/oauth/token',
      expect.objectContaining({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
      }),
      expect.any(Object),
    );
    expect(integrationTokenRepository.update).toHaveBeenCalledWith(
      { id: 'token-1' },
      expect.objectContaining({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        scope: 'read:jira-work offline_access',
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: '10001',
        key: 'SWP',
        name: 'SWP Project',
      }),
    ]);
  });

  it('returns reconnect-required error when Jira refresh fails', async () => {
    integrationTokenRepository.findOne.mockResolvedValue(jiraToken);
    httpService.axiosRef.post.mockRejectedValue({
      response: {
        status: 400,
        data: { error_description: 'Unknown or invalid refresh token.' },
      },
    });

    await expect(service.getProjects('user-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'TOKEN_EXPIRED',
        reconnectRequired: true,
      }),
      status: 401,
    });
  });

  it('maps Jira insufficient-scope responses without downgrading status', async () => {
    integrationTokenRepository.findOne.mockResolvedValue({
      ...jiraToken,
      token_expires_at: null,
    });
    httpService.axiosRef.get.mockResolvedValue({
      data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
    });
    httpService.get.mockReturnValue(
      throwError(() => ({
        response: { status: 403, data: { message: 'Forbidden' } },
      })),
    );

    await expect(service.getProjects('user-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_SCOPE',
        reconnectRequired: true,
      }),
      status: 403,
    });
  });

  it('validates Jira project access and returns the stored key shape', async () => {
    integrationTokenRepository.findOne.mockResolvedValue({
      ...jiraToken,
      token_expires_at: null,
      access_token: 'valid-access-token',
    });
    httpService.axiosRef.get.mockResolvedValue({
      data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
    });
    httpService.get.mockReturnValue(
      of({
        data: {
          id: '10001',
          key: 'MOB',
          name: 'Mobile Project',
        },
      }),
    );

    const result = await service.validateProjectAccess('user-1', 'MOB');

    expect(result).toEqual(
      expect.objectContaining({
        id: '10001',
        key: 'MOB',
        name: 'Mobile Project',
      }),
    );
  });

  it('returns true when Jira account is an explicit project role actor', async () => {
    integrationTokenRepository.findOne.mockResolvedValue({
      ...jiraToken,
      token_expires_at: null,
      access_token: 'valid-access-token',
    });
    httpService.axiosRef.get
      .mockResolvedValueOnce({
        data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
      })
      .mockResolvedValueOnce({
        data: {
          actors: [
            {
              actorUser: {
                accountId: 'jira-user-1',
              },
            },
          ],
        },
      });
    httpService.get.mockReturnValue(
      of({
        data: {
          Administrators:
            'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/project/MOB/role/10002',
        },
      }),
    );

    await expect(
      service.isExplicitProjectMember('user-1', 'MOB', 'jira-user-1'),
    ).resolves.toBe(true);
  });

  it('returns false when Jira account is not listed in project role actors', async () => {
    integrationTokenRepository.findOne.mockResolvedValue({
      ...jiraToken,
      token_expires_at: null,
      access_token: 'valid-access-token',
    });
    httpService.axiosRef.get
      .mockResolvedValueOnce({
        data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'cloud-1', scopes: ['read:jira-work'] }],
      })
      .mockResolvedValueOnce({
        data: {
          actors: [
            {
              actorUser: {
                accountId: 'jira-someone-else',
              },
            },
          ],
        },
      });
    httpService.get.mockReturnValue(
      of({
        data: {
          Users:
            'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/project/MOB/role/10003',
        },
      }),
    );

    await expect(
      service.isExplicitProjectMember('user-1', 'MOB', 'jira-user-1'),
    ).resolves.toBe(false);
  });
});
