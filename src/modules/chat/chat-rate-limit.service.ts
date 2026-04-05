import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ERROR_MESSAGES } from '../../common/constants';

const WINDOW_MS = 60_000;
const MAX_MESSAGES = 30;

@Injectable()
export class ChatRateLimitService {
  private static readonly hits = new Map<string, number[]>();
  private readonly logger = new Logger(ChatRateLimitService.name);

  consume(userId: string) {
    const now = Date.now();
    const key = `chat-send:${userId}`;
    const existing =
      ChatRateLimitService.hits
        .get(key)
        ?.filter((timestamp) => now - timestamp < WINDOW_MS) || [];

    if (existing.length >= MAX_MESSAGES) {
      this.logger.warn(
        JSON.stringify({
          event: 'chat_rate_limited',
          actor_user_id: userId,
        }),
      );
      throw new HttpException(
        {
          code: 'CHAT_RATE_LIMITED',
          message: ERROR_MESSAGES.CHAT.RATE_LIMITED,
          statusCode: 429,
        },
        429,
      );
    }

    existing.push(now);
    ChatRateLimitService.hits.set(key, existing);
  }
}

@Injectable()
export class ChatSendRateLimitGuard implements CanActivate {
  constructor(private readonly chatRateLimitService: ChatRateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (userId) {
      this.chatRateLimitService.consume(userId);
    }

    return true;
  }
}
