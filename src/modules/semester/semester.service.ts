import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AuthProvider, Role, SemesterStatus } from '../../common/enums';
import {
  Class,
  ClassMembership,
  Group,
  ImportBatch,
  ImportRowLog,
  Semester,
  User,
} from '../../entities';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import { SemesterImportRow } from './utils/semester-import.util';

type ImportMode = 'VALIDATE' | 'IMPORT';

@Injectable()
export class SemesterService {
  private readonly logger = new Logger(SemesterService.name);

  constructor(
    @InjectRepository(Semester)
    private readonly semesterRepository: Repository<Semester>,
    @InjectRepository(ImportBatch)
    private readonly importBatchRepository: Repository<ImportBatch>,
    @InjectRepository(ImportRowLog)
    private readonly importRowLogRepository: Repository<ImportRowLog>,
    @InjectRepository(Class)
    private readonly classRepository: Repository<Class>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepository: Repository<ClassMembership>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createSemester(dto: CreateSemesterDto) {
    const existing = await this.semesterRepository.findOne({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      throw new ConflictException('Semester code already exists.');
    }

    const semester = this.semesterRepository.create({
      ...dto,
      code: dto.code.toUpperCase(),
      status: dto.status || SemesterStatus.UPCOMING,
    });

    return this.semesterRepository.save(semester);
  }

  async listSemesters() {
    return this.semesterRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async updateSemester(id: string, dto: UpdateSemesterDto) {
    const semester = await this.getSemesterOrThrow(id);

    if (dto.code && dto.code.toUpperCase() !== semester.code) {
      const existing = await this.semesterRepository.findOne({
        where: { code: dto.code.toUpperCase() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Semester code already exists.');
      }
    }

    Object.assign(semester, {
      ...dto,
      code: dto.code ? dto.code.toUpperCase() : semester.code,
    });

    return this.semesterRepository.save(semester);
  }

  async getImportBatches(semesterId: string) {
    await this.getSemesterOrThrow(semesterId);

    return this.importBatchRepository.find({
      where: { semester_id: semesterId },
      relations: ['rows'],
      order: { created_at: 'DESC' },
      take: 10,
    });
  }

  async processImport(
    semesterId: string,
    uploadedById: string,
    fileName: string,
    rows: SemesterImportRow[],
    mode: ImportMode,
  ) {
    const semester = await this.getSemesterOrThrow(semesterId);
    if (semester.status === SemesterStatus.CLOSED) {
      throw new BadRequestException(
        'Cannot import into a closed semester.',
      );
    }

    const summary = {
      rows: {
        total: rows.length,
        success: 0,
        failed: 0,
        skipped: 0,
      },
      classes: { created: 0, updated: 0 },
      lecturers: { created: 0, updated: 0 },
      students: { created: 0, updated: 0 },
      enrollments: { created: 0, skipped: 0 },
    };
    const counterKeys = {
      classes: { created: new Set<string>(), updated: new Set<string>() },
      lecturers: { created: new Set<string>(), updated: new Set<string>() },
      students: { created: new Set<string>(), updated: new Set<string>() },
      enrollments: { created: new Set<string>(), skipped: new Set<string>() },
    };
    const markCounter = <
      TSection extends keyof typeof counterKeys,
      TField extends keyof (typeof counterKeys)[TSection],
    >(
      section: TSection,
      field: TField,
      key: string,
    ) => {
      const bucket = counterKeys[section][field] as Set<string>;
      if (!bucket.has(key)) {
        bucket.add(key);
        (
          summary[section] as Record<string, number>
        )[field as string] += 1;
      }
    };

    const correlationId = randomBytes(6).toString('hex');
    const batch = await this.importBatchRepository.save(
      this.importBatchRepository.create({
        semester_id: semester.id,
        uploaded_by_id: uploadedById,
        file_name: fileName,
        mode,
        total_rows: rows.length,
        correlation_id: correlationId,
      }),
    );

    const rowLogs: ImportRowLog[] = [];
    const lecturerPlans = new Map<string, SemesterImportRow>();
    const existingUsers = new Map(
      (
        await this.userRepository.find({
          where: rows.map((row) => ({ email: row.email.toLowerCase() })),
        })
      ).map((user) => [user.email.toLowerCase(), user]),
    );
    const existingClasses = new Map(
      (
        await this.classRepository.find({
          where: rows.map((row) => ({
            code: row.class_code,
            semester: semester.code,
          })),
          relations: ['lecturer'],
        })
      ).map((classItem) => [`${semester.code}:${classItem.code}`, classItem]),
    );
    const createdClasses = new Map<string, Class>();

    for (const row of rows) {
      if (row.role.trim().toUpperCase() === Role.LECTURER) {
        const key = row.class_code.trim().toUpperCase();
        if (!lecturerPlans.has(key)) {
          lecturerPlans.set(key, {
            ...row,
            class_code: key,
            semester_code: row.semester_code.trim().toUpperCase(),
            role: Role.LECTURER,
          });
        }
      }
    }

    const ensureLecturerUser = async (plan: SemesterImportRow) => {
      const email = plan.email.toLowerCase();
      let user = existingUsers.get(email);
      let created = false;

      if (user && user.role !== Role.LECTURER) {
        throw new BadRequestException(
          `Email ${plan.email} already belongs to a non-lecturer account.`,
        );
      }

      if (!user && mode === 'IMPORT') {
        const tempPassword = randomBytes(8).toString('hex');
        user = await this.userRepository.save(
          this.userRepository.create({
            email,
            full_name: plan.full_name,
            password_hash: await bcrypt.hash(tempPassword, 10),
            role: Role.LECTURER,
            primary_provider: AuthProvider.EMAIL,
          }),
        );
        existingUsers.set(email, user);
        created = true;
      }

      if (!user && mode === 'VALIDATE') {
        created = true;
      }

      return { user, created };
    };

    const ensureClassForCode = async (classCode: string) => {
      const key = `${semester.code}:${classCode}`;
      const currentClass = createdClasses.get(key) || existingClasses.get(key);
      if (currentClass) {
        return currentClass;
      }

      const plan = lecturerPlans.get(classCode);
      if (!plan) {
        return null;
      }

      const { user, created } = await ensureLecturerUser(plan);
      if (created) {
        markCounter('lecturers', 'created', plan.email.toLowerCase());
      }

      if (mode === 'VALIDATE') {
        return {
          id: `preview-${classCode}`,
          code: classCode,
          name: plan.class_name,
          semester: semester.code,
          lecturer_id: user?.id || `preview-lecturer-${classCode}`,
          enrollment_key: 'PREVIEW',
        } as Class;
      }

      const savedClass = await this.classRepository.save(
        this.classRepository.create({
          code: classCode,
          name: plan.class_name,
          semester: semester.code,
          lecturer_id: user!.id,
          enrollment_key: randomBytes(4).toString('hex').toUpperCase(),
        }),
      );

      await this.groupRepository.insert(
        Array.from({ length: 7 }).map((_, index) => ({
          name: `Group ${index + 1}`,
          class_id: savedClass.id,
          created_by_id: user!.id,
          semester: semester.code,
        })),
      );

      createdClasses.set(key, savedClass);
      markCounter('classes', 'created', key);

      return savedClass;
    };

    for (const row of rows) {
      const normalizedRole = row.role.trim().toUpperCase();
      const normalizedSemesterCode = row.semester_code.trim().toUpperCase();
      const normalizedEmail = row.email.trim().toLowerCase();
      const normalizedClassCode = row.class_code.trim().toUpperCase();
      const normalizedClassName = row.class_name.trim();
      const logPayload = { ...row };

      const fail = (message: string) => {
        summary.rows.failed += 1;
        rowLogs.push(
          this.importRowLogRepository.create({
            batch_id: batch.id,
            row_number: row.row_number,
            role: normalizedRole || null,
            email: normalizedEmail || null,
            class_code: normalizedClassCode || null,
            status: 'FAILED',
            message,
            payload: logPayload,
          }),
        );
      };

      if (!['LECTURER', 'STUDENT'].includes(normalizedRole)) {
        fail('Role must be either LECTURER or STUDENT.');
        continue;
      }
      if (
        !normalizedSemesterCode ||
        !normalizedEmail ||
        !normalizedClassCode ||
        !normalizedClassName
      ) {
        fail(
          'Missing required fields: semester_code, email, class_code, class_name.',
        );
        continue;
      }
      if (normalizedSemesterCode !== semester.code) {
        fail(
          `semester_code ${normalizedSemesterCode} does not match selected semester ${semester.code}.`,
        );
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        fail('Invalid email format.');
        continue;
      }
      if (normalizedRole === 'STUDENT' && !row.student_id.trim()) {
        fail('student_id is required for STUDENT rows.');
        continue;
      }

      try {
        if (normalizedRole === 'LECTURER') {
          const existingClass =
            existingClasses.get(`${semester.code}:${normalizedClassCode}`) ||
            createdClasses.get(`${semester.code}:${normalizedClassCode}`);

          const { user, created } = await ensureLecturerUser({
            ...row,
            role: normalizedRole,
            email: normalizedEmail,
            class_code: normalizedClassCode,
            class_name: normalizedClassName,
          });

          if (created) {
            markCounter('lecturers', 'created', normalizedEmail);
          } else {
            markCounter('lecturers', 'updated', normalizedEmail);
          }

          if (!existingClass) {
            await ensureClassForCode(normalizedClassCode);
          } else if (
            mode === 'IMPORT' &&
            (existingClass.name !== normalizedClassName ||
              existingClass.lecturer_id !== user?.id)
          ) {
            await this.classRepository.update(
              { id: existingClass.id },
              { name: normalizedClassName, lecturer_id: user!.id },
            );
            markCounter(
              'classes',
              'updated',
              `${semester.code}:${normalizedClassCode}`,
            );
          } else if (existingClass) {
            markCounter(
              'classes',
              'updated',
              `${semester.code}:${normalizedClassCode}`,
            );
          }

          summary.rows.success += 1;
          rowLogs.push(
            this.importRowLogRepository.create({
              batch_id: batch.id,
              row_number: row.row_number,
              role: normalizedRole,
              email: normalizedEmail,
              class_code: normalizedClassCode,
              status: 'SUCCESS',
              message: existingClass
                ? 'Lecturer/class mapping validated.'
                : 'Lecturer/class provisioning prepared.',
              payload: logPayload,
            }),
          );
          continue;
        }

        const targetClass = await ensureClassForCode(normalizedClassCode);
        if (!targetClass) {
          fail(
            'Class is not provisioned in the selected semester and no lecturer row was provided for this class.',
          );
          continue;
        }

        let student = existingUsers.get(normalizedEmail);
        let createdStudent = false;

        if (student && student.role !== Role.STUDENT) {
          fail(
            `Email ${row.email} already belongs to a non-student account.`,
          );
          continue;
        }

        if (!student && mode === 'IMPORT') {
          student = await this.userRepository.save(
            this.userRepository.create({
              email: normalizedEmail,
              full_name: row.full_name.trim(),
              student_id: row.student_id.trim(),
              password_hash: await bcrypt.hash(
                randomBytes(8).toString('hex'),
                10,
              ),
              role: Role.STUDENT,
              primary_provider: AuthProvider.EMAIL,
            }),
          );
          existingUsers.set(normalizedEmail, student);
          createdStudent = true;
        }

        if (!student && mode === 'VALIDATE') {
          createdStudent = true;
        }

        if (createdStudent) {
          markCounter('students', 'created', normalizedEmail);
        } else {
          markCounter('students', 'updated', normalizedEmail);
        }

        if (mode === 'IMPORT') {
          const existingMembership = await this.classMembershipRepository.findOne({
            where: { class_id: targetClass.id, user_id: student!.id },
          });

          if (existingMembership) {
            summary.rows.skipped += 1;
            markCounter(
              'enrollments',
              'skipped',
              `${targetClass.id}:${student!.id}`,
            );
            rowLogs.push(
              this.importRowLogRepository.create({
                batch_id: batch.id,
                row_number: row.row_number,
                role: normalizedRole,
                email: normalizedEmail,
                class_code: normalizedClassCode,
                status: 'SKIPPED',
                message: 'Student is already enrolled in this class.',
                payload: logPayload,
              }),
            );
            continue;
          }

          await this.classMembershipRepository.save(
            this.classMembershipRepository.create({
              class_id: targetClass.id,
              user_id: student!.id,
            }),
          );
          markCounter(
            'enrollments',
            'created',
            `${targetClass.id}:${student!.id}`,
          );
        }

        summary.rows.success += 1;
        rowLogs.push(
          this.importRowLogRepository.create({
            batch_id: batch.id,
            row_number: row.row_number,
            role: normalizedRole,
            email: normalizedEmail,
            class_code: normalizedClassCode,
            status: 'SUCCESS',
            message:
              mode === 'VALIDATE'
                ? 'Student row validated successfully.'
                : 'Student enrolled successfully.',
            payload: logPayload,
          }),
        );
      } catch (error) {
        fail(
          error instanceof Error ? error.message : 'Unexpected import error.',
        );
      }
    }

    batch.success_rows = summary.rows.success;
    batch.failed_rows = summary.rows.failed;
    batch.summary = summary as unknown as Record<string, unknown>;
    await this.importBatchRepository.save(batch);
    if (rowLogs.length > 0) {
      await this.importRowLogRepository.save(rowLogs);
    }

    this.logger.log(
      `[${batch.correlation_id}] ${mode} completed for semester ${semester.code}: ${summary.rows.success} success, ${summary.rows.failed} failed, ${summary.rows.skipped} skipped.`,
    );

    return {
      batchId: batch.id,
      correlationId: batch.correlation_id,
      semester: {
        id: semester.id,
        code: semester.code,
        name: semester.name,
        status: semester.status,
      },
      summary,
      readyForImport: summary.rows.failed === 0,
      rows: rowLogs.map((log) => ({
        row_number: log.row_number,
        role: log.role,
        email: log.email,
        class_code: log.class_code,
        status: log.status,
        message: log.message,
      })),
    };
  }

  private async getSemesterOrThrow(id: string) {
    const semester = await this.semesterRepository.findOne({
      where: { id },
    });
    if (!semester) {
      throw new NotFoundException('Semester not found.');
    }
    return semester;
  }
}
