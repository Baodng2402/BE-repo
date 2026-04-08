import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, LessThan, Not } from 'typeorm';
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
import { ChatService } from './chat.service';

const mockRepo = () => ({
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((value) => value),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ChatService', () => {
  let service: ChatService;
  let conversationRepository: ReturnType<typeof mockRepo>;
  let messageRepository: ReturnType<typeof mockRepo>;
  let semesterRepository: ReturnType<typeof mockRepo>;
  let classRepository: ReturnType<typeof mockRepo>;
  let userRepository: ReturnType<typeof mockRepo>;
  let groupRepository: ReturnType<typeof mockRepo>;
  let classMembershipRepository: ReturnType<typeof mockRepo>;
  let groupMembershipRepository: ReturnType<typeof mockRepo>;
  let teachingAssignmentRepository: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    conversationRepository = mockRepo();
    messageRepository = mockRepo();
    semesterRepository = mockRepo();
    classRepository = mockRepo();
    userRepository = mockRepo();
    groupRepository = mockRepo();
    classMembershipRepository = mockRepo();
    groupMembershipRepository = mockRepo();
    teachingAssignmentRepository = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepository,
        },
        { provide: getRepositoryToken(Message), useValue: messageRepository },
        { provide: getRepositoryToken(Semester), useValue: semesterRepository },
        { provide: getRepositoryToken(Class), useValue: classRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Group), useValue: groupRepository },
        {
          provide: getRepositoryToken(ClassMembership),
          useValue: classMembershipRepository,
        },
        {
          provide: getRepositoryToken(GroupMembership),
          useValue: groupMembershipRepository,
        },
        {
          provide: getRepositoryToken(TeachingAssignment),
          useValue: teachingAssignmentRepository,
        },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('creates or returns a valid conversation for the student of the class', async () => {
    semesterRepository.findOne.mockResolvedValue({
      id: 'sem-1',
      code: 'SP26',
      name: 'Spring 2026',
    });
    classRepository.findOne.mockResolvedValue({
      id: 'class-1',
      code: 'SEP490',
      semester: 'SP26',
      lecturer_id: 'lecturer-1',
    });
    userRepository.findOne
      .mockResolvedValueOnce({
        id: 'student-1',
        role: Role.STUDENT,
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
      })
      .mockResolvedValueOnce({
        id: 'lecturer-1',
        role: Role.LECTURER,
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer A',
      });
    classMembershipRepository.findOne.mockResolvedValue({
      class_id: 'class-1',
      user_id: 'student-1',
    });
    teachingAssignmentRepository.findOne.mockResolvedValue({ id: 'ta-1' });
    conversationRepository.findOne.mockResolvedValue(null);
    conversationRepository.save.mockResolvedValue({ id: 'conv-1' });
    conversationRepository.findOneOrFail.mockResolvedValue({
      id: 'conv-1',
      semester_id: 'sem-1',
      class_id: 'class-1',
      student_id: 'student-1',
      lecturer_id: 'lecturer-1',
      status: ChatConversationStatus.ACTIVE,
      last_message_preview: null,
      last_message_at: null,
      created_at: new Date('2026-03-27T10:00:00.000Z'),
      updated_at: new Date('2026-03-27T10:00:00.000Z'),
      semester: { name: 'Spring 2026' },
      class: { code: 'SEP490' },
      student: {
        id: 'student-1',
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
        role: Role.STUDENT,
      },
      lecturer: {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer A',
        role: Role.LECTURER,
      },
    });

    const result = await service.getOrCreateConversation(
      'student-1',
      Role.STUDENT,
      {
        semester_id: 'sem-1',
        class_id: 'class-1',
        student_id: 'student-1',
        lecturer_id: 'lecturer-1',
      },
    );

    expect(result.id).toBe('conv-1');
    expect(result.counterpart.id).toBe('lecturer-1');
  });

  it('rejects a student opening a conversation outside their class context', async () => {
    semesterRepository.findOne.mockResolvedValue({
      id: 'sem-1',
      code: 'SP26',
      name: 'Spring 2026',
    });
    classRepository.findOne.mockResolvedValue({
      id: 'class-1',
      code: 'SEP490',
      semester: 'SP26',
      lecturer_id: 'lecturer-1',
    });
    userRepository.findOne
      .mockResolvedValueOnce({
        id: 'student-1',
        role: Role.STUDENT,
        email: 'student@fpt.edu.vn',
      })
      .mockResolvedValueOnce({
        id: 'lecturer-1',
        role: Role.LECTURER,
        email: 'lecturer@fpt.edu.vn',
      });
    classMembershipRepository.findOne.mockResolvedValue(null);
    teachingAssignmentRepository.findOne.mockResolvedValue({ id: 'ta-1' });

    await expect(
      service.getOrCreateConversation('student-1', Role.STUDENT, {
        semester_id: 'sem-1',
        class_id: 'class-1',
        student_id: 'student-1',
        lecturer_id: 'lecturer-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks sending into a conversation the lecturer does not belong to', async () => {
    conversationRepository.findOne.mockResolvedValue({
      id: 'conv-1',
      student_id: 'student-1',
      lecturer_id: 'lecturer-2',
      status: ChatConversationStatus.ACTIVE,
      semester: { name: 'Spring 2026' },
      class: { code: 'SEP490' },
      student: {
        id: 'student-1',
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
        role: Role.STUDENT,
      },
      lecturer: {
        id: 'lecturer-2',
        email: 'lecturer2@fpt.edu.vn',
        full_name: 'Lecturer B',
        role: Role.LECTURER,
      },
    });

    await expect(
      service.createMessage('lecturer-1', 'conv-1', { content: 'Hello' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns existing message for duplicate client_id without creating a new row', async () => {
    conversationRepository.findOne.mockResolvedValue({
      id: 'conv-1',
      student_id: 'student-1',
      lecturer_id: 'lecturer-1',
      status: ChatConversationStatus.ACTIVE,
      semester: { name: 'Spring 2026' },
      class: { code: 'SEP490' },
      student: {
        id: 'student-1',
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
        role: Role.STUDENT,
      },
      lecturer: {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer A',
        role: Role.LECTURER,
      },
    });
    messageRepository.findOne.mockResolvedValue({
      id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'student-1',
      content: 'Hello',
      type: ChatMessageType.TEXT,
      client_id: 'mobile-1',
      read_by_recipient_at: null,
      created_at: new Date('2026-03-27T10:00:00.000Z'),
      updated_at: new Date('2026-03-27T10:00:00.000Z'),
    });

    const result = await service.createMessage('student-1', 'conv-1', {
      content: 'Hello',
      client_id: 'mobile-1',
    });

    expect(result.id).toBe('msg-1');
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('lists messages in created_at desc order with cursor pagination', async () => {
    conversationRepository.findOne.mockResolvedValue({
      id: 'conv-1',
      student_id: 'student-1',
      lecturer_id: 'lecturer-1',
      semester: { name: 'Spring 2026' },
      class: { code: 'SEP490' },
      student: {
        id: 'student-1',
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
        role: Role.STUDENT,
      },
      lecturer: {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer A',
        role: Role.LECTURER,
      },
    });
    messageRepository.find.mockResolvedValue([
      {
        id: 'msg-3',
        conversation_id: 'conv-1',
        sender_id: 'student-1',
        content: 'Third',
        type: ChatMessageType.TEXT,
        client_id: null,
        read_by_recipient_at: null,
        created_at: new Date('2026-03-27T12:00:00.000Z'),
        updated_at: new Date('2026-03-27T12:00:00.000Z'),
      },
      {
        id: 'msg-2',
        conversation_id: 'conv-1',
        sender_id: 'lecturer-1',
        content: 'Second',
        type: ChatMessageType.TEXT,
        client_id: null,
        read_by_recipient_at: null,
        created_at: new Date('2026-03-27T11:00:00.000Z'),
        updated_at: new Date('2026-03-27T11:00:00.000Z'),
      },
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'student-1',
        content: 'First',
        type: ChatMessageType.TEXT,
        client_id: null,
        read_by_recipient_at: null,
        created_at: new Date('2026-03-27T10:00:00.000Z'),
        updated_at: new Date('2026-03-27T10:00:00.000Z'),
      },
    ]);

    const result = await service.listMessages('student-1', 'conv-1', {
      limit: 2,
      cursor: '2026-03-27T13:00:00.000Z',
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('msg-3');
    expect(result.data[1].id).toBe('msg-2');
    expect(result.meta.has_more).toBe(true);
    expect(result.meta.next_cursor).toBe('2026-03-27T11:00:00.000Z__msg-2');
    expect(messageRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { created_at: 'DESC', id: 'DESC' },
        take: 3,
        where: {
          conversation_id: 'conv-1',
          created_at: LessThan(new Date('2026-03-27T13:00:00.000Z')),
        },
      }),
    );
  });

  it('marks unread conversation messages as read for the recipient only', async () => {
    conversationRepository.findOne.mockResolvedValue({
      id: 'conv-1',
      student_id: 'student-1',
      lecturer_id: 'lecturer-1',
      semester: { name: 'Spring 2026' },
      class: { code: 'SEP490' },
      student: {
        id: 'student-1',
        email: 'student@fpt.edu.vn',
        full_name: 'Student A',
        role: Role.STUDENT,
      },
      lecturer: {
        id: 'lecturer-1',
        email: 'lecturer@fpt.edu.vn',
        full_name: 'Lecturer A',
        role: Role.LECTURER,
      },
    });
    messageRepository.update.mockResolvedValue({ affected: 2 });

    const result = await service.markConversationRead('student-1', 'conv-1');

    expect(result.read_count).toBe(2);
    expect(messageRepository.update).toHaveBeenCalledWith(
      {
        conversation_id: 'conv-1',
        sender_id: Not('student-1'),
        read_by_recipient_at: IsNull(),
      },
      { read_by_recipient_at: expect.any(Date) },
    );
  });
});
