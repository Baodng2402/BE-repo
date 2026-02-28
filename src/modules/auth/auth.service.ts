import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../../common/constants';
import {
  AuthProvider,
  IntegrationProvider,
  IntegrationToken,
  User,
} from '../../entities';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: string;
}

export interface OAuthProfile {
  id: string; // Provider's user ID
  username?: string;
  email?: string;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

export interface UserTokenPayloadDto {
  id: string;
  email: string;
  full_name: string | null;
  student_id: string | null;
  role: string;
  created_at: Date;
}

export interface UserResponse {
  id: string;
  email: string;
  full_name: string | null;
  student_id: string | null;
  role: string;
}

export interface AuthResponse {
  user: UserTokenPayloadDto;
  access_token: string;
}

export interface LoginResponse {
  user: UserResponse;
  access_token: string;
}

export interface LinkedAccountResponse {
  provider: string;
  provider_username: string | null;
  provider_email: string | null;
  created_at: Date;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  refresh_token?: string;
}

export interface GitHubUserProfile {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface GitHubUserEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility?: string;
}

export interface JiraTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export interface JiraUserProfile {
  account_id: string;
  name: string;
  email: string;
  picture: string;
  account_type: string;
  account_status: string;
  extended_profile: any;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    private jwtService: JwtService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  // ============ Email/Password Authentication ============

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException(ERROR_MESSAGES.AUTH.EMAIL_ALREADY_EXISTS);
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const newUser = this.userRepository.create({
      email: registerDto.email,
      password_hash: hashedPassword,
      full_name: registerDto.fullName,
      student_id: registerDto.studentId,
      primary_provider: AuthProvider.EMAIL,
    });

    const savedUser = await this.userRepository.save(newUser);

    const user: UserTokenPayloadDto = {
      id: savedUser.id,
      email: savedUser.email,
      full_name: savedUser.full_name,
      student_id: savedUser.student_id,
      role: savedUser.role,
      created_at: savedUser.created_at,
    };

    return {
      user,
      access_token: this.generateJwtToken(user),
    };
  }

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const user: User | null = await this.validateUser(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    await this.userRepository.update(
      { id: user.id },
      { last_login: new Date() },
    );

    const userTokenPayloadDto: UserTokenPayloadDto = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      student_id: user.student_id,
      role: user.role,
      created_at: user.created_at,
    };

    const userResponse: UserResponse = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      student_id: user.student_id,
      role: user.role,
    };

    return {
      user: userResponse,
      access_token: this.generateJwtToken(userTokenPayloadDto),
    };
  }

  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user || !user.password_hash) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  // ============ OAuth Account Linking ============

  async findUserByOAuthProvider(
    provider: IntegrationProvider,
    providerId: string,
  ) {
    const integration = await this.integrationTokenRepository.findOne({
      where: {
        provider,
        provider_user_id: providerId,
      },
      relations: ['user'],
    });

    return integration;
  }

  async linkOAuthAccount(
    userId: string,
    provider: IntegrationProvider,
    profile: OAuthProfile,
    accessToken: string,
    refreshToken?: string,
  ) {
    const existingLink = await this.integrationTokenRepository.findOne({
      where: {
        user_id: userId,
        provider,
      },
    });

    if (existingLink) {
      await this.integrationTokenRepository.update(
        { id: existingLink.id },
        {
          provider_user_id: profile.id,
          provider_username: profile.username,
          provider_email: profile.email,
          access_token: accessToken,
          refresh_token: refreshToken,
          used_for_login: true,
          last_refreshed_at: new Date(),
        },
      );
      return this.integrationTokenRepository.findOne({
        where: { id: existingLink.id },
      });
    }

    const newLink = this.integrationTokenRepository.create({
      user_id: userId,
      provider,
      provider_user_id: profile.id,
      provider_username: profile.username,
      provider_email: profile.email,
      access_token: accessToken,
      refresh_token: refreshToken,
      used_for_login: true,
    });

    return this.integrationTokenRepository.save(newLink);
  }

  async findOrCreateOAuthUser(
    provider: IntegrationProvider,
    profile: OAuthProfile,
    accessToken: string,
    refreshToken?: string,
  ): Promise<User> {
    const existingIntegration = await this.findUserByOAuthProvider(
      provider,
      profile.id,
    );

    if (existingIntegration) {
      await this.linkOAuthAccount(
        existingIntegration.user.id,
        provider,
        profile,
        accessToken,
        refreshToken,
      );
      return existingIntegration.user;
    }

    if (profile.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: profile.email },
      });

      if (existingUser) {
        await this.linkOAuthAccount(
          existingUser.id,
          provider,
          profile,
          accessToken,
          refreshToken,
        );
        return existingUser;
      }
    }

    const newUser = this.userRepository.create({
      email:
        profile.email ||
        `${provider.toLowerCase()}_${profile.id}@placeholder.local`,
      full_name: profile.displayName || profile.username || 'User',
      avatar_url: profile.photos?.[0]?.value,
      primary_provider:
        provider === IntegrationProvider.GITHUB
          ? AuthProvider.GITHUB
          : AuthProvider.JIRA,
      password_hash: null,
    });

    const savedUser = await this.userRepository.save(newUser);

    await this.linkOAuthAccount(
      savedUser.id,
      provider,
      profile,
      accessToken,
      refreshToken,
    );

    return savedUser;
  }

  async unlinkOAuthAccount(userId: string, provider: IntegrationProvider) {
    const integration = await this.integrationTokenRepository.findOne({
      where: {
        user_id: userId,
        provider,
      },
    });

    if (!integration) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.ACCOUNT_NOT_LINKED);
    }

    await this.integrationTokenRepository.delete({ id: integration.id });

    return { message: SUCCESS_MESSAGES.AUTH.ACCOUNT_UNLINKED };
  }

  // ============ GitHub OAuth Manual Flow ============

  async handleGitHubCallback(code: string) {
    const clientId = this.configService.get<string>('GH_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GH_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.GITHUB_NOT_CONFIGURED);
    }

    try {
      const tokenResponse =
        await this.httpService.axiosRef.post<GitHubTokenResponse>(
          'https://github.com/login/oauth/access_token',
          {
            client_id: clientId,
            client_secret: clientSecret,
            code,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        );

      const tokenData: GitHubTokenResponse = tokenResponse.data;

      if (!tokenData.access_token) {
        throw new BadRequestException(
          ERROR_MESSAGES.AUTH.GITHUB_TOKEN_EXCHANGE_FAILED,
        );
      }

      const profileResponse =
        await this.httpService.axiosRef.get<GitHubUserProfile>(
          'https://api.github.com/user',
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              Accept: 'application/vnd.github+json',
            },
          },
        );

      const profile: GitHubUserProfile = profileResponse.data;

      const emailResponse = await this.httpService.axiosRef.get<
        GitHubUserEmail[]
      >('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });

      const emails = emailResponse.data;
      const primaryEmail = emails.find(
        (e: GitHubUserEmail) => e.primary,
      )!.email;

      const oauthProfile = {
        id: String(profile.id),
        username: profile.login,
        email: primaryEmail,
        displayName: profile.name,
        photos: profile.avatar_url ? [{ value: profile.avatar_url }] : [],
      };

      const user = await this.findOrCreateOAuthUser(
        IntegrationProvider.GITHUB,
        oauthProfile,
        tokenData.access_token,
        tokenData.refresh_token,
      );

      return user;
    } catch (error) {
      const serviceName = this.constructor.name;
      const methodName = this.handleGitHubCallback.name;
      console.error(`[${serviceName} - ${methodName}]`, error);
      throw new BadRequestException(ERROR_MESSAGES.AUTH.GITHUB_OAUTH_FAILED);
    }
  }

  // ============ Jira OAuth Manual Flow ============

  async handleJiraCallback(code: string) {
    const clientId = this.configService.get<string>('JIRA_CLIENT_ID');
    const clientSecret = this.configService.get<string>('JIRA_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('JIRA_CALLBACK_URL');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException('Jira credentials not configured properly');
    }

    try {
      const tokenResponse =
        await this.httpService.axiosRef.post<JiraTokenResponse>(
          'https://auth.atlassian.com/oauth/token',
          {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

      const tokenData: JiraTokenResponse = tokenResponse.data;

      if (!tokenData.access_token) {
        throw new BadRequestException('Jira token exchange failed');
      }

      const profileResponse =
        await this.httpService.axiosRef.get<JiraUserProfile>(
          'https://api.atlassian.com/me',
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              Accept: 'application/json',
            },
          },
        );

      const profile: JiraUserProfile = profileResponse.data;

      const oauthProfile: OAuthProfile = {
        id: profile.account_id,
        username: profile.name,
        email: profile.email,
        displayName: profile.name,
        photos: profile.picture ? [{ value: profile.picture }] : [],
      };

      const user = await this.findOrCreateOAuthUser(
        IntegrationProvider.JIRA,
        oauthProfile,
        tokenData.access_token,
        tokenData.refresh_token,
      );

      return user;
    } catch (error: any) {
      const serviceName = this.constructor.name;
      const methodName = this.handleJiraCallback.name;
      console.error(
        `[${serviceName} - ${methodName}]`,
        error?.response?.data || error.message,
      );
      throw new BadRequestException('Jira OAuth failed');
    }
  }

  // ============ JWT Token Generation ============

  generateJwtToken(user: UserTokenPayloadDto) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }

  async getLinkedAccounts(userId: string) {
    return this.integrationTokenRepository.find({
      where: {
        user_id: userId,
        used_for_login: true,
      },
      select: {
        provider: true,
        provider_username: true,
        provider_email: true,
        created_at: true,
      },
    });
  }
}
