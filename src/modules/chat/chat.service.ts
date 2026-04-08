import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Equal, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { ERROR_MESSAGES } from '../../common/constants';
import {
  ChatConversationStatus,
  ChatMessageType,
  Role,
} from '../../common/enums';
import {
  Class,
  ClassMembership,
  Conversation,
  Group,
  GroupMembership,
  Message,
  Semester,
  TeachingAssignment,
  User,
} from '../../entities';
import { GetOrCreateConversationDto } from './dto/get-or-create-conversation.dto';
import { GetOrCreateGroupConversationDto } from './dto/get-or-create-group-conversation.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

interface ConversationContext {
  semester: Semester;
  class: Class;
  student: User;
  lecturer: User;
}

interface GroupConversationContext {
  semester: Semester;
  class: Class;
  group: Group;
  lecturer: User;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Semester)
    private readonly semesterRepository: Repository<Semester>,
    @InjectRepository(Class)
    private readonly classRepository: Repository<Class>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepository: Repository<ClassMembership>,
    @InjectRepository(GroupMembership)
    private readonly groupMembershipRepository: Repository<GroupMembership>,
    @InjectRepository(TeachingAssignment)
    private readonly teachingAssignmentRepository: Repository<TeachingAssignment>,
  ) {}

  async getOrCreateConversation(
    currentUserId: string,
    currentUserRole: Role,
    dto: GetOrCreateConversationDto,
  ) {
    const context = await this.validateConversationContext(
      currentUserId,
      currentUserRole,
      dto,
    );

    const existing = await this.findConversationByContext(dto);

    if (existing) {
      return this.mapConversation(existing, currentUserId, null, 0);
    }

    let saved: Conversation;
    try {
      saved = await this.conversationRepository.save(
        this.conversationRepository.create({
          semester_id: context.semester.id,
          class_id: context.class.id,
          student_id: context.student.id,
          lecturer_id: context.lecturer.id,
          status: ChatConversationStatus.ACTIVE,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const concurrentExisting = await this.findConversationByContext(dto);
        if (concurrentExisting) {
          return this.mapConversation(
            concurrentExisting,
            currentUserId,
            null,
            0,
          );
        }
      }
      throw error;
    }

    const conversation = await this.conversationRepository.findOneOrFail({
      where: { id: saved.id },
      relations: {
        semester: true,
        class: true,
        student: true,
        lecturer: true,
      },
    });

    return this.mapConversation(conversation, currentUserId, null, 0);
  }

  async listConversations(currentUserId: string) {
    const memberGroupIds = await this.listActiveGroupIdsForUser(currentUserId);
    const where:
      | Array<{
          student_id?: string;
          lecturer_id?: string;
          group_id?: ReturnType<typeof In<string>>;
        }>
      | {
          student_id?: string;
          lecturer_id?: string;
        } = [{ student_id: currentUserId }, { lecturer_id: currentUserId }];

    if (memberGroupIds.length > 0) {
      where.push({ group_id: In(memberGroupIds) });
    }

    const conversations = await this.conversationRepository.find({
      where,
      relations: {
        semester: true,
        class: true,
        group: true,
        student: true,
        lecturer: true,
      },
      order: {
        last_message_at: 'DESC',
        updated_at: 'DESC',
      },
    });

    if (conversations.length === 0) {
      return { data: [] };
    }

    const conversationIds = conversations.map(
      (conversation) => conversation.id,
    );

    const latestMessages = await this.messageRepository
      .createQueryBuilder('message')
      .distinctOn(['message.conversation_id'])
      .where('message.conversation_id IN (:...conversationIds)', {
        conversationIds,
      })
      .orderBy('message.conversation_id', 'ASC')
      .addOrderBy('message.created_at', 'DESC')
      .getMany();

    const latestByConversationId = new Map(
      latestMessages.map((message) => [message.conversation_id, message]),
    );

    const unreadRows = await this.messageRepository
      .createQueryBuilder('message')
      .select('message.conversation_id', 'conversation_id')
      .addSelect('COUNT(*)', 'count')
      .where('message.conversation_id IN (:...conversationIds)', {
        conversationIds,
      })
      .andWhere('message.sender_id != :currentUserId', { currentUserId })
      .andWhere('message.read_by_recipient_at IS NULL')
      .groupBy('message.conversation_id')
      .getRawMany<{ conversation_id: string; count: string }>();

    const unreadByConversationId = new Map(
      unreadRows.map((row) => [row.conversation_id, parseInt(row.count, 10)]),
    );

    return {
      data: conversations.map((conversation) =>
        this.mapConversation(
          conversation,
          currentUserId,
          latestByConversationId.get(conversation.id) || null,
          unreadByConversationId.get(conversation.id) || 0,
        ),
      ),
    };
  }

  async listMessages(
    currentUserId: string,
    conversationId: string,
    query: QueryChatMessagesDto,
  ) {
    await this.requireConversationAccess(currentUserId, conversationId);

    const limit = query.limit ?? 20;
    let where:
      | {
          conversation_id: string;
          created_at?: ReturnType<typeof LessThan<Date>>;
        }
      | Array<{
          conversation_id: string;
          created_at:
            | ReturnType<typeof LessThan<Date>>
            | ReturnType<typeof Equal<Date>>;
          id?: ReturnType<typeof LessThan<string>>;
        }> = {
      conversation_id: conversationId,
    };

    if (query.cursor) {
      const parsedCursor = this.parseMessageCursor(query.cursor);
      if (parsedCursor.id) {
        where = [
          {
            conversation_id: conversationId,
            created_at: LessThan(parsedCursor.createdAt),
          },
          {
            conversation_id: conversationId,
            created_at: Equal(parsedCursor.createdAt),
            id: LessThan(parsedCursor.id),
          },
        ];
      } else {
        where = {
          conversation_id: conversationId,
          created_at: LessThan(parsedCursor.createdAt),
        };
      }
    }

    const messages = await this.messageRepository.find({
      where,
      order: { created_at: 'DESC', id: 'DESC' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const pageItems = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore
      ? this.buildMessageCursor(pageItems[pageItems.length - 1])
      : null;

    return {
      data: pageItems.map((message) => this.mapMessage(message)),
      meta: {
        next_cursor: nextCursor,
        limit,
        has_more: hasMore,
      },
    };
  }

  async createMessage(
    currentUserId: string,
    conversationId: string,
    dto: SendChatMessageDto,
  ) {
    if (!dto.content?.trim()) {
      throw this.buildBadRequest(
        'CHAT_INVALID_PAYLOAD',
        ERROR_MESSAGES.CHAT.INVALID_PAYLOAD,
      );
    }

    const conversation = await this.requireConversationAccess(
      currentUserId,
      conversationId,
    );

    if (conversation.status === ChatConversationStatus.CLOSED) {
      throw new ConflictException({
        code: 'CHAT_CLOSED',
        message: ERROR_MESSAGES.CHAT.CLOSED,
      });
    }

    if (dto.client_id) {
      const existing = await this.messageRepository.findOne({
        where: {
          conversation_id: conversationId,
          client_id: dto.client_id,
        },
      });

      if (existing) {
        return this.mapMessage(existing);
      }
    }

    let message: Message;
    try {
      message = await this.messageRepository.save(
        this.messageRepository.create({
          conversation_id: conversation.id,
          sender_id: currentUserId,
          content: dto.content.trim(),
          type: dto.type || ChatMessageType.TEXT,
          client_id: dto.client_id || null,
        }),
      );
    } catch (error) {
      if (dto.client_id && this.isUniqueViolation(error)) {
        const existingAfterConflict = await this.messageRepository.findOne({
          where: {
            conversation_id: conversation.id,
            client_id: dto.client_id,
          },
        });

        if (existingAfterConflict) {
          return this.mapMessage(existingAfterConflict);
        }

        throw new ConflictException({
          code: 'CHAT_DUPLICATE_CLIENT_ID',
          message: ERROR_MESSAGES.CHAT.DUPLICATE_CLIENT_ID,
        });
      }

      throw error;
    }

    await this.conversationRepository.save({
      id: conversation.id,
      last_message_at: message.created_at,
      last_message_preview: this.buildPreview(message.content),
    });

    return this.mapMessage(message);
  }

  async markConversationRead(currentUserId: string, conversationId: string) {
    await this.requireConversationAccess(currentUserId, conversationId);
    const readAt = new Date();

    const result = await this.messageRepository.update(
      {
        conversation_id: conversationId,
        sender_id: Not(currentUserId),
        read_by_recipient_at: IsNull(),
      },
      { read_by_recipient_at: readAt },
    );

    return {
      conversation_id: conversationId,
      read_count: result.affected || 0,
      read_at: readAt,
    };
  }

  async markMessageRead(currentUserId: string, messageId: string) {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: 'Message not found.',
      });
    }

    await this.requireConversationAccess(
      currentUserId,
      message.conversation_id,
    );
    const readAt = new Date();

    const result = await this.messageRepository
      .createQueryBuilder()
      .update(Message)
      .set({ read_by_recipient_at: readAt })
      .where('conversation_id = :conversationId', {
        conversationId: message.conversation_id,
      })
      .andWhere('sender_id != :currentUserId', { currentUserId })
      .andWhere('read_by_recipient_at IS NULL')
      .andWhere('created_at <= :createdAt', { createdAt: message.created_at })
      .execute();

    return {
      conversation_id: message.conversation_id,
      read_count: result.affected || 0,
      read_at: readAt,
    };
  }

  async listConversationIdsForUser(currentUserId: string) {
    const memberGroupIds = await this.listActiveGroupIdsForUser(currentUserId);
    const where:
      | Array<{
          student_id?: string;
          lecturer_id?: string;
          group_id?: ReturnType<typeof In<string>>;
        }>
      | {
          student_id?: string;
          lecturer_id?: string;
        } = [{ student_id: currentUserId }, { lecturer_id: currentUserId }];

    if (memberGroupIds.length > 0) {
      where.push({ group_id: In(memberGroupIds) });
    }

    const conversations = await this.conversationRepository.find({
      where,
      select: { id: true },
    });

    return conversations.map((conversation) => conversation.id);
  }

  async assertRealtimeAccess(currentUserId: string, conversationId: string) {
    return this.requireConversationAccess(currentUserId, conversationId);
  }

  async getOrCreateGroupConversation(
    currentUserId: string,
    currentUserRole: Role,
    dto: GetOrCreateGroupConversationDto,
  ) {
    const context = await this.validateGroupConversationContext(
      currentUserId,
      currentUserRole,
      dto,
    );

    const existing = await this.findGroupConversationByContext(
      context.semester.id,
      context.class.id,
      context.group.id,
      context.lecturer.id,
    );

    if (existing) {
      return this.mapConversation(existing, currentUserId, null, 0);
    }

    let saved: Conversation;
    try {
      saved = await this.conversationRepository.save(
        this.conversationRepository.create({
          semester_id: context.semester.id,
          class_id: context.class.id,
          group_id: context.group.id,
          lecturer_id: context.lecturer.id,
          student_id: null,
          status: ChatConversationStatus.ACTIVE,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const concurrentExisting = await this.findGroupConversationByContext(
          context.semester.id,
          context.class.id,
          context.group.id,
          context.lecturer.id,
        );
        if (concurrentExisting) {
          return this.mapConversation(
            concurrentExisting,
            currentUserId,
            null,
            0,
          );
        }
      }
      throw error;
    }

    const conversation = await this.conversationRepository.findOneOrFail({
      where: { id: saved.id },
      relations: {
        semester: true,
        class: true,
        group: true,
        student: true,
        lecturer: true,
      },
    });

    return this.mapConversation(conversation, currentUserId, null, 0);
  }

  private async validateConversationContext(
    currentUserId: string,
    currentUserRole: Role,
    dto: GetOrCreateConversationDto,
  ): Promise<ConversationContext> {
    const [semester, cls, student, lecturer] = await Promise.all([
      this.semesterRepository.findOne({ where: { id: dto.semester_id } }),
      this.classRepository.findOne({ where: { id: dto.class_id } }),
      this.userRepository.findOne({ where: { id: dto.student_id } }),
      this.userRepository.findOne({ where: { id: dto.lecturer_id } }),
    ]);

    if (!semester || !cls || !student || !lecturer) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    if (cls.semester !== semester.code) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
        {
          reason: 'class_not_in_semester',
        },
      );
    }

    if (![Role.STUDENT, Role.GROUP_LEADER].includes(student.role)) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        'student_id must belong to a student account.',
      );
    }

    if (lecturer.role !== Role.LECTURER) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        'lecturer_id must belong to a lecturer account.',
      );
    }

    const [classMembership, teachingAssignment] = await Promise.all([
      this.classMembershipRepository.findOne({
        where: {
          class_id: cls.id,
          user_id: student.id,
        },
      }),
      this.teachingAssignmentRepository.findOne({
        where: {
          semester_id: semester.id,
          class_id: cls.id,
          lecturer_id: lecturer.id,
        },
      }),
    ]);

    const lecturerMatchesClass =
      !!teachingAssignment || cls.lecturer_id === lecturer.id;

    if (!classMembership || !lecturerMatchesClass) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    if ([Role.STUDENT, Role.GROUP_LEADER].includes(currentUserRole)) {
      if (currentUserId !== student.id) {
        throw this.buildForbidden();
      }
    } else if (currentUserRole === Role.LECTURER) {
      if (currentUserId !== lecturer.id) {
        throw this.buildForbidden();
      }
    } else {
      throw this.buildForbidden();
    }

    return { semester, class: cls, student, lecturer };
  }

  private async requireConversationAccess(
    currentUserId: string,
    conversationId: string,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: {
        semester: true,
        class: true,
        group: true,
        student: true,
        lecturer: true,
      },
    });

    if (!conversation) {
      throw this.buildNotFound();
    }

    if (conversation.group_id) {
      const isGroupMember = await this.isActiveGroupMember(
        conversation.group_id,
        currentUserId,
      );
      if (conversation.lecturer_id !== currentUserId && !isGroupMember) {
        throw this.buildForbidden();
      }
    } else if (
      conversation.student_id !== currentUserId &&
      conversation.lecturer_id !== currentUserId
    ) {
      throw this.buildForbidden();
    }

    return conversation;
  }

  private mapConversation(
    conversation: Conversation,
    currentUserId: string,
    lastMessage: Message | null,
    unreadCount: number,
  ) {
    const isGroupRoom = !!conversation.group_id;
    const counterpart =
      !isGroupRoom && conversation.student_id === currentUserId
        ? conversation.lecturer
        : !isGroupRoom
          ? conversation.student
          : null;

    return {
      id: conversation.id,
      semester_id: conversation.semester_id,
      class_id: conversation.class_id,
      group_id: conversation.group_id,
      group_name: conversation.group?.name ?? null,
      is_group_room: isGroupRoom,
      student_id: conversation.student_id,
      lecturer_id: conversation.lecturer_id,
      status: conversation.status,
      last_message_preview: conversation.last_message_preview,
      last_message_at: conversation.last_message_at,
      unread_count: unreadCount,
      last_message: lastMessage ? this.mapMessage(lastMessage) : null,
      counterpart: counterpart
        ? {
            id: counterpart.id,
            email: counterpart.email,
            full_name: counterpart.full_name,
            role: counterpart.role,
          }
        : null,
      class_code: conversation.class.code,
      semester_name: conversation.semester.name,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  private mapMessage(message: Message) {
    return {
      id: message.id,
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      content: message.content,
      type: message.type,
      client_id: message.client_id,
      read_by_recipient_at: message.read_by_recipient_at,
      created_at: message.created_at,
      updated_at: message.updated_at,
    };
  }

  private parseMessageCursor(cursor: string) {
    const [createdAtRaw, idRaw] = cursor.split('__', 2);
    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime())) {
      throw this.buildBadRequest(
        'CHAT_INVALID_PAYLOAD',
        'cursor must be a valid ISO datetime string or composite cursor token.',
      );
    }

    return {
      createdAt,
      id: idRaw?.trim() || null,
    };
  }

  private buildMessageCursor(message: Message | undefined) {
    if (!message) {
      return null;
    }

    return `${message.created_at.toISOString()}__${message.id}`;
  }

  private async findConversationByContext(dto: GetOrCreateConversationDto) {
    return this.conversationRepository.findOne({
      where: {
        semester_id: dto.semester_id,
        class_id: dto.class_id,
        student_id: dto.student_id,
        lecturer_id: dto.lecturer_id,
      },
      relations: {
        semester: true,
        class: true,
        group: true,
        student: true,
        lecturer: true,
      },
    });
  }

  private async findGroupConversationByContext(
    semesterId: string,
    classId: string,
    groupId: string,
    lecturerId: string,
  ) {
    return this.conversationRepository.findOne({
      where: {
        semester_id: semesterId,
        class_id: classId,
        group_id: groupId,
        lecturer_id: lecturerId,
      },
      relations: {
        semester: true,
        class: true,
        group: true,
        student: true,
        lecturer: true,
      },
    });
  }

  private async validateGroupConversationContext(
    currentUserId: string,
    currentUserRole: Role,
    dto: GetOrCreateGroupConversationDto,
  ): Promise<GroupConversationContext> {
    const [semester, cls, group] = await Promise.all([
      this.semesterRepository.findOne({ where: { id: dto.semester_id } }),
      this.classRepository.findOne({ where: { id: dto.class_id } }),
      this.groupRepository.findOne({ where: { id: dto.group_id } }),
    ]);

    if (!semester || !cls || !group) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    if (cls.semester !== semester.code || group.class_id !== cls.id) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    const teachingAssignments = await this.teachingAssignmentRepository.find({
      where: {
        semester_id: semester.id,
        class_id: cls.id,
      },
      select: { lecturer_id: true },
    });
    const assignedLecturerIds = new Set(
      teachingAssignments.map((item) => item.lecturer_id),
    );
    if (cls.lecturer_id) {
      assignedLecturerIds.add(cls.lecturer_id);
    }

    if (currentUserRole === Role.LECTURER) {
      if (dto.lecturer_id && dto.lecturer_id !== currentUserId) {
        throw this.buildForbidden();
      }
      if (!assignedLecturerIds.has(currentUserId)) {
        throw this.buildForbidden();
      }

      const lecturer = await this.userRepository.findOne({
        where: { id: currentUserId },
      });
      if (!lecturer || lecturer.role !== Role.LECTURER) {
        throw this.buildForbidden();
      }

      return {
        semester,
        class: cls,
        group,
        lecturer,
      };
    }

    if (![Role.STUDENT, Role.GROUP_LEADER].includes(currentUserRole)) {
      throw this.buildForbidden();
    }

    const membership = await this.groupMembershipRepository.findOne({
      where: {
        group_id: group.id,
        user_id: currentUserId,
        left_at: IsNull(),
      },
    });

    if (!membership) {
      throw this.buildForbidden();
    }

    const targetLecturerId =
      dto.lecturer_id || [...assignedLecturerIds.values()][0];

    if (!targetLecturerId || !assignedLecturerIds.has(targetLecturerId)) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    const lecturer = await this.userRepository.findOne({
      where: { id: targetLecturerId },
    });

    if (!lecturer || lecturer.role !== Role.LECTURER) {
      throw this.buildBadRequest(
        'CHAT_INVALID_CONTEXT',
        ERROR_MESSAGES.CHAT.INVALID_CONTEXT,
      );
    }

    return {
      semester,
      class: cls,
      group,
      lecturer,
    };
  }

  private async listActiveGroupIdsForUser(userId: string) {
    const memberships = await this.groupMembershipRepository.find({
      where: {
        user_id: userId,
        left_at: IsNull(),
      },
      select: { group_id: true },
    });

    return memberships.map((membership) => membership.group_id);
  }

  private async isActiveGroupMember(groupId: string, userId: string) {
    const membership = await this.groupMembershipRepository.findOne({
      where: {
        group_id: groupId,
        user_id: userId,
        left_at: IsNull(),
      },
      select: { user_id: true },
    });

    return !!membership;
  }

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return true;
    }

    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object') {
      const statusCode = (response as { statusCode?: number }).statusCode;
      if (statusCode === 409) {
        return true;
      }
    }

    return false;
  }

  private buildPreview(content: string) {
    return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  }

  private buildForbidden() {
    return new ForbiddenException({
      code: 'CHAT_FORBIDDEN',
      message: ERROR_MESSAGES.CHAT.FORBIDDEN,
    });
  }

  private buildNotFound() {
    return new NotFoundException({
      code: 'CHAT_NOT_FOUND',
      message: ERROR_MESSAGES.CHAT.NOT_FOUND,
    });
  }

  private buildBadRequest(code: string, message: string, details?: unknown) {
    this.logger.warn(
      JSON.stringify({
        event: 'chat_bad_request',
        code,
        message,
      }),
    );

    return new BadRequestException({ code, message, details });
  }
}
