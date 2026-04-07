import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../common/enums';
import { ClassMembership } from '../../entities/class-membership.entity';
import { Class } from '../../entities/class.entity';
import { Group } from '../../entities/group.entity';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { MailService } from '../mail/mail.service';
import { ClassService } from './class.service';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'uuid-1', ...entity })),
  insert: jest.fn(),
});

describe('ClassService', () => {
  let service: ClassService;
  let userRepo: ReturnType<typeof mockRepo>;
  let classRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let notifRepo: ReturnType<typeof mockRepo>;
  let mailService: { queueEmail: jest.Mock };

  beforeEach(async () => {
    userRepo = mockRepo();
    classRepo = mockRepo();
    membershipRepo = mockRepo();
    notifRepo = mockRepo();
    mailService = { queueEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassService,
        { provide: getRepositoryToken(Class), useValue: classRepo },
        {
          provide: getRepositoryToken(ClassMembership),
          useValue: membershipRepo,
        },
        { provide: getRepositoryToken(Group), useValue: mockRepo() },
        { provide: getRepositoryToken(Notification), useValue: notifRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<ClassService>(ClassService);
  });

  it('blocks legacy lecturer class creation flow', async () => {
    await expect(
      service.createClass('lecturer-1', {
        code: 'SWP391-1004',
        name: 'SWP391 1004',
        semester: 'SP26',
        studentEmails: [],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns classes assigned to lecturer for myClasses', async () => {
    classRepo.find.mockResolvedValue([
      { id: 'class-1', code: 'SWP391', lecturer_id: 'lecturer-1' },
    ]);

    const result = await service.myClasses('lecturer-1', Role.LECTURER);

    expect(classRepo.find).toHaveBeenCalledWith({
      where: { lecturer_id: 'lecturer-1' },
      order: { code: 'ASC' },
    });
    expect(result).toHaveLength(1);
  });

  it('returns enrolled classes for student myClasses', async () => {
    membershipRepo.find.mockResolvedValue([
      {
        class: { id: 'class-2', code: 'SWP392', semester: 'SP26' },
      },
      {
        class: null,
      },
    ]);

    const result = await service.myClasses('student-1', Role.STUDENT);

    expect(membershipRepo.find).toHaveBeenCalledWith({
      where: { user_id: 'student-1' },
      relations: ['class'],
    });
    expect(result).toEqual([
      { id: 'class-2', code: 'SWP392', semester: 'SP26' },
    ]);
  });

  describe('importStudents', () => {
    const classId = 'class-uuid';
    const mockClass = {
      id: classId,
      code: 'SWP391',
      name: 'Software Architecture',
      semester: 'SP26',
      enrollment_key: 'A1B2C3D4',
      lecturer: { full_name: 'Dr. Nguyen' },
    };

    beforeEach(() => {
      classRepo.findOne.mockResolvedValue(mockClass);
    });

    it('should enroll existing users and create new ones', async () => {
      const rows = [
        {
          email: 'existing@fpt.edu.vn',
          student_id: 'SE001',
          full_name: 'Existing Student',
        },
        {
          email: 'new@fpt.edu.vn',
          student_id: 'SE002',
          full_name: 'New Student',
        },
      ];

      // existing user found
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'user-1', email: 'existing@fpt.edu.vn' })
        .mockResolvedValueOnce(null); // new user not found

      // membership check — not already enrolled
      membershipRepo.findOne.mockResolvedValue(null);

      const result = await service.importStudents(classId, rows);

      expect(result.total).toBe(2);
      expect(result.enrolled).toBe(2);
      expect(result.created).toBe(1);
      expect(result.already_enrolled).toBe(0);
      expect(mailService.queueEmail).toHaveBeenCalledTimes(2);
    });

    it('should skip already enrolled students', async () => {
      const rows = [
        {
          email: 'enrolled@fpt.edu.vn',
          student_id: 'SE001',
          full_name: 'Already Enrolled',
        },
      ];

      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'enrolled@fpt.edu.vn',
      });
      membershipRepo.findOne.mockResolvedValue({
        class_id: classId,
        user_id: 'user-1',
      });

      const result = await service.importStudents(classId, rows);

      expect(result.already_enrolled).toBe(1);
      expect(result.enrolled).toBe(0);
    });

    it('should return warning when fewer than 15 students', async () => {
      const rows = [
        {
          email: 'a@fpt.edu.vn',
          student_id: 'SE001',
          full_name: 'Student A',
        },
      ];

      userRepo.findOne.mockResolvedValue(null);
      membershipRepo.findOne.mockResolvedValue(null);

      const result = await service.importStudents(classId, rows);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('fewer than 15'),
      );
    });

    it('should throw if class not found', async () => {
      classRepo.findOne.mockResolvedValue(null);

      await expect(service.importStudents('bad-id', [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should report invalid email rows in failed array', async () => {
      const rows = [
        { email: 'not-an-email', student_id: 'SE001', full_name: 'Bad' },
        { email: 'good@fpt.edu.vn', student_id: 'SE002', full_name: 'Good' },
      ];

      userRepo.findOne.mockResolvedValue(null);
      membershipRepo.findOne.mockResolvedValue(null);

      const result = await service.importStudents(classId, rows);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].email).toBe('not-an-email');
      expect(result.enrolled).toBe(1);
    });

    it('should create in-app notification only for existing users', async () => {
      const rows = [
        {
          email: 'existing@fpt.edu.vn',
          student_id: 'SE001',
          full_name: 'Existing',
        },
        { email: 'new@fpt.edu.vn', student_id: 'SE002', full_name: 'New' },
      ];

      userRepo.findOne
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'existing@fpt.edu.vn',
        })
        .mockResolvedValueOnce(null);
      membershipRepo.findOne.mockResolvedValue(null);

      await service.importStudents(classId, rows);

      // Only 1 in-app notification (for existing user)
      expect(notifRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
