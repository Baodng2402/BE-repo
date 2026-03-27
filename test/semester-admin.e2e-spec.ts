import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { SemesterController } from '../src/modules/semester/semester.controller';
import { SemesterService } from '../src/modules/semester/semester.service';

describe('SemesterController admin roster (e2e)', () => {
  let app: INestApplication<App>;
  const semesterService = {
    listSemesters: jest.fn(),
    createSemester: jest.fn(),
    updateSemester: jest.fn(),
    getImportBatches: jest.fn(),
    processImport: jest.fn(),
    getSemesterRoster: jest.fn(),
    createSemesterLecturer: jest.fn(),
    updateSemesterLecturer: jest.fn(),
    deleteSemesterLecturer: jest.fn(),
    createSemesterStudent: jest.fn(),
    updateSemesterStudent: jest.fn(),
    deleteSemesterStudent: jest.fn(),
    bulkReassignTeachingAssignments: jest.fn(),
    getExaminerAssignments: jest.fn(),
    bulkAssignExaminers: jest.fn(),
  };

  class MockJwtGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      req.user = { id: 'admin-1', role: 'ADMIN' };
      return true;
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SemesterController],
      providers: [{ provide: SemesterService, useValue: semesterService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns roster happy path', async () => {
    semesterService.getSemesterRoster.mockResolvedValue({
      semester: { id: 'semester-1', code: 'SP26' },
      summary: { classes_total: 1 },
      lecturers: [],
      students: [],
      classes: [],
    });

    await request(app.getHttpServer())
      .get('/admin/semesters/11111111-1111-1111-1111-111111111111/roster')
      .expect(200)
      .expect(({ body }) => {
        expect(body.semester.code).toBe('SP26');
      });
  });

  it('updates teaching assignments happy path', async () => {
    semesterService.bulkReassignTeachingAssignments.mockResolvedValue({
      classes: [{ id: 'class-1', lecturer_id: 'lecturer-1' }],
    });

    await request(app.getHttpServer())
      .patch(
        '/admin/semesters/11111111-1111-1111-1111-111111111111/teaching-assignments',
      )
      .send({
        assignments: [{ class_id: 'class-1', lecturer_id: 'lecturer-1' }],
      })
      .expect(200);
  });

  it('rejects examiner own-class conflict', async () => {
    semesterService.bulkAssignExaminers.mockRejectedValue(
      new ConflictException({
        code: 'EXAMINER_OWN_CLASS_CONFLICT',
        message: 'Lecturer cannot examine a class they are teaching.',
      }),
    );

    await request(app.getHttpServer())
      .patch(
        '/admin/semesters/11111111-1111-1111-1111-111111111111/examiner-assignments',
      )
      .send({
        assignments: [{ class_id: 'class-1', lecturer_ids: ['lecturer-1'] }],
      })
      .expect(409);
  });

  it('rejects examiner assignment before week gate', async () => {
    semesterService.bulkAssignExaminers.mockRejectedValue(
      new BadRequestException({
        code: 'WEEK_GATE_NOT_REACHED',
        message: 'Examiner assignment is only available from week 10 onward.',
      }),
    );

    await request(app.getHttpServer())
      .patch(
        '/admin/semesters/11111111-1111-1111-1111-111111111111/examiner-assignments',
      )
      .send({
        assignments: [{ class_id: 'class-1', lecturer_ids: ['lecturer-2'] }],
      })
      .expect(400);
  });
});
