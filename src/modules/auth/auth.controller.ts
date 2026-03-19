import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import { IntegrationProvider } from '../../entities';
import { User } from '../../entities/user.entity';
import { RedisService } from '../../redis/redis.service';
import {
  AuthResponse,
  AuthService,
  LinkedAccountResponse,
  LoginResponse,
} from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  OptionalJwtAuthGuard,
  RequestUser,
} from './guards/optional-jwt-auth.guard';

export interface AuthorizedRequest extends Request {
  user: RequestUser;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  private getAllowedRedirectOrigins(): string[] {
    return (
      this.configService
        .get<string>('ALLOWED_CORS_ORIGINS')
        ?.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0) || ['http://localhost:3000']
    );
  }

  private isValidRedirectUri(
    redirectUri: string | undefined,
    allowedOrigins: string[],
  ): boolean {
    if (!redirectUri) {
      return false;
    }

    const normalizedRedirectUri = redirectUri.trim();

    if (
      allowedOrigins.some((origin) => normalizedRedirectUri.startsWith(origin))
    ) {
      return true;
    }

    const customSchemeMatch = normalizedRedirectUri.match(
      /^([a-z][a-z0-9+\-.]*):\/\//i,
    );

    if (!customSchemeMatch) {
      return false;
    }

    const redirectScheme = customSchemeMatch[1].toLowerCase();
    const allowedCustomSchemes = allowedOrigins
      .map((origin) =>
        origin.match(/^([a-z][a-z0-9+\-.]*):\/\//i)?.[1].toLowerCase(),
      )
      .filter(
        (scheme): scheme is string =>
          !!scheme && scheme !== 'http' && scheme !== 'https',
      );

    return allowedCustomSchemes.includes(redirectScheme);
  }

  private buildTokenRedirectUrl(redirectUri: string, token: string): string {
    const normalizedRedirectUri = redirectUri.trim();
    const redirectUrl = new URL(normalizedRedirectUri);

    // Keep backward compatibility for web clients that pass only a base origin.
    if (
      (redirectUrl.protocol === 'http:' || redirectUrl.protocol === 'https:') &&
      (redirectUrl.pathname === '/' || redirectUrl.pathname === '')
    ) {
      redirectUrl.pathname = '/auth/callback';
    }

    redirectUrl.searchParams.set('token', token);
    return redirectUrl.toString();
  }

  // ============ Email/Password Authentication ============

  @Post('register')
  @ApiOperation({ summary: 'Register new user with email and password' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful, returns JWT token',
  })
  @ApiResponse({ status: 400, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(loginDto);

    // Set secure httpOnly cookie to maintain session identically to OAuth flow
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('auth_token', result.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return result;
  }

  // ============ GitHub OAuth ============

  @Get('github')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Initiate GitHub OAuth flow (❌ Do not use "Try it out")',
    description:
      '<b>Note:</b> Do not use the "Try it out" button here. It will fail with a CORS error because it tries to fetch the GitHub login page. <br />👉 <b>Open this URL in a new browser tab instead:</b> <a href="/api/auth/github" target="_blank">/api/auth/github</a>',
  })
  @ApiResponse({ status: 302, description: 'Redirects to GitHub OAuth' })
  async githubAuth(
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ) {
    // Validate redirect_uri against allowed origins from environment
    const allowedOrigins = this.getAllowedRedirectOrigins();
    const isValidRedirectUri = this.isValidRedirectUri(
      redirectUri,
      allowedOrigins,
    );

    if (!redirectUri || !isValidRedirectUri) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_REDIRECT_URI);
    }

    // Generate state and store redirect_uri
    const state = randomUUID();
    await this.redisService.setOAuthState(state, redirectUri);

    // Build GitHub OAuth URL with state parameter
    const clientId = this.configService.get<string>('GH_CLIENT_ID');
    const callbackUrl = this.configService.get<string>('GH_CALLBACK_URL', '');
    const scope = 'user:email read:user repo';

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&state=${state}`;

    res.redirect(githubAuthUrl);
  }

  @Get('github/callback')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'GitHub OAuth callback (internal use)' })
  @ApiResponse({
    status: 302,
    description: 'Sets auth cookie and redirects to frontend',
  })
  async githubCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request & { user?: RequestUser },
    @Res() res: Response,
  ) {
    // Validate required parameters
    if (!code || code.length === 0 || !state || state.length === 0) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.MISSING_PARAMETER);
    }

    // Retrieve redirect_uri from Redis using state
    const redirectUri = await this.redisService.getOAuthState(state);

    if (!redirectUri) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_OAUTH_STATE);
    }

    // Delete state from Redis (one-time use)
    await this.redisService.deleteOAuthState(state);

    // Handle GitHub OAuth callback manually (exchange code for user)
    const user = await this.authService.handleGitHubCallback(
      code,
      req.user?.id,
    );
    const token = this.authService.generateJwtToken(user);

    // Set secure httpOnly cookie
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Redirect with token for mobile deep links and web callback handling.
    res.redirect(this.buildTokenRedirectUrl(redirectUri, token));
  }

  // ============ Jira OAuth ============

  @Get('jira')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Initiate Jira/Atlassian OAuth flow',
    description:
      '<b>Note:</b> Open this URL in a new browser tab to authenticate with Jira.',
  })
  @ApiResponse({ status: 302, description: 'Redirects to Jira OAuth' })
  async jiraAuth(
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ) {
    const allowedOrigins = this.getAllowedRedirectOrigins();
    const isValidRedirectUri = this.isValidRedirectUri(
      redirectUri,
      allowedOrigins,
    );

    if (!redirectUri || !isValidRedirectUri) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_REDIRECT_URI);
    }

    const state = randomUUID();
    await this.redisService.setOAuthState(state, redirectUri);

    const clientId = this.configService.get<string>('JIRA_CLIENT_ID');
    const callbackUrl = this.configService.get<string>('JIRA_CALLBACK_URL', '');
    const scope =
      'read:jira-work read:jira-user read:me read:account offline_access';

    const jiraAuthUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}&response_type=code&prompt=consent`;

    res.redirect(jiraAuthUrl);
  }

  @Get('jira/callback')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Jira OAuth callback (internal use)' })
  @ApiResponse({
    status: 302,
    description: 'Sets auth cookie and redirects to frontend',
  })
  async jiraCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request & { user?: RequestUser },
    @Res() res: Response,
  ) {
    if (!code || code.length === 0 || !state || state.length === 0) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.MISSING_PARAMETER);
    }

    const redirectUri = await this.redisService.getOAuthState(state);

    if (!redirectUri) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_OAUTH_STATE);
    }

    await this.redisService.deleteOAuthState(state);

    const user = await this.authService.handleJiraCallback(code, req.user?.id);
    const token = this.authService.generateJwtToken(user);

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(this.buildTokenRedirectUrl(redirectUri, token));
  }

  // ============ Account Management ============

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Returns user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  // TODO: Fix this endpoint to return proper user data using JWT
  getCurrentUser(@Req() req: Request) {
    return req.user;
  }

  @Get('linked-accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all linked OAuth accounts' })
  @ApiResponse({ status: 200, description: 'Returns list of linked accounts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getLinkedAccounts(
    @Req() req: AuthorizedRequest,
  ): Promise<LinkedAccountResponse[]> {
    return await this.authService.getLinkedAccounts(req.user.id);
  }

  @Delete('unlink/:provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink an OAuth provider' })
  @ApiParam({ name: 'provider', enum: ['GITHUB', 'JIRA'] })
  @ApiResponse({ status: 200, description: 'Provider unlinked successfully' })
  @ApiResponse({ status: 400, description: 'Provider not linked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unlinkAccount(
    @Req() req: AuthorizedRequest,
    @Param('provider') provider: string,
  ) {
    if (!['GITHUB', 'JIRA'].includes(provider.toUpperCase())) {
      throw new BadRequestException(ERROR_MESSAGES.AUTH.INVALID_PROVIDER);
    }
    const providerEnum = provider.toUpperCase();
    return await this.authService.unlinkOAuthAccount(
      req.user.id,
      providerEnum as IntegrationProvider,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user and clear auth cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  logout(@Res() res: Response) {
    res.clearCookie('auth_token');
    return res.json({ message: 'Logged out successfully' });
  }
}
