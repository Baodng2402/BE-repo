import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { ClassMembership } from '../../entities/class-membership.entity';
import { Class } from '../../entities/class.entity';
import { Group } from '../../entities/group.entity';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { MailService } from '../mail/mail.service';
import { classEnrollmentEmail } from '../mail/templates/class-enrollment';
import { CreateClassDto } from './dto/create-class.dto';
import {
  ImportFailedRow,
  ImportStudentsResponseDto,
} from './dto/import-students-response.dto';
import { JoinClassDto } from './dto/join-class.dto';
import { StudentRow } from './utils/file-parser.util';

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);

  constructor(
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassMembership)
    private readonly classMembershipRepo: Repository<ClassMembership>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  async createClass(lecturerId: string, dto: CreateClassDto) {
    // 1. Generate Enrollment Key
    const enrollmentKey = randomBytes(4).toString('hex').toUpperCase();

    // 2. Create the Class
    const newClass = this.classRepo.create({
      code: dto.code,
      name: dto.name,
      semester: dto.semester,
      lecturer_id: lecturerId,
      enrollment_key: enrollmentKey,
    });
    const savedClass = await this.classRepo.save(newClass);

    // 3. Auto-generate 7 Empty Groups
    const groupsToCreate: Partial<Group>[] = [];
    for (let i = 1; i <= 7; i++) {
      groupsToCreate.push({
        name: `Group ${i}`,
        class_id: savedClass.id,
        created_by_id: lecturerId, // using lecturer as the original creator
      });
    }
    await this.groupRepo.insert(groupsToCreate);

    // 4. Send Notifications to students
    if (dto.studentEmails && dto.studentEmails.length > 0) {
      const students = await this.userRepo.find({
        where: { email: In(dto.studentEmails) },
      });

      if (students.length > 0) {
        const notifications = students.map((student) => ({
          user_id: student.id,
          title: `You are invited to join ${dto.code}`,
          message: `Lecturer has invited you to join ${dto.code}. Your enrollment key is: ${enrollmentKey}`,
        }));
        await this.notifRepo.insert(notifications);
      }
    }

    return savedClass;
  }

  async getAllClasses(userId: string, role: string) {
    if (role === 'LECTURER') {
      return this.classRepo.find({ where: { lecturer_id: userId } });
    } else {
      // Return classes the student is enrolled in + available classes? Let's just return all for simplicity or only valid ones.
      return this.classRepo.find();
    }
  }

  async myClasses(studentId: string) {
    const memberships = await this.classMembershipRepo.find({
      where: { user_id: studentId },
      relations: ['class'],
    });
    return memberships.map((m) => m.class);
  }

  async joinClass(studentId: string, classId: string, dto: JoinClassDto) {
    const targetClass = await this.classRepo.findOne({
      where: { id: classId },
    });
    if (!targetClass) {
      throw new NotFoundException('Class not found');
    }

    if (targetClass.enrollment_key !== dto.enrollment_key) {
      throw new BadRequestException('Invalid enrollment key');
    }

    const existing = await this.classMembershipRepo.findOne({
      where: { class_id: classId, user_id: studentId },
    });

    if (existing) {
      throw new BadRequestException('You are already in this class');
    }

    const membership = this.classMembershipRepo.create({
      class_id: classId,
      user_id: studentId,
    });

    await this.classMembershipRepo.save(membership);
    return { message: 'Joined class successfully' };
  }

  async importStudents(
    classId: string,
    rows: StudentRow[],
  ): Promise<ImportStudentsResponseDto> {
    const targetClass = await this.classRepo.findOne({
      where: { id: classId },
      relations: ['lecturer'],
    });
    if (!targetClass) {
      throw new NotFoundException('Class not found');
    }

    const result: ImportStudentsResponseDto = {
      total: rows.length,
      enrolled: 0,
      created: 0,
      already_enrolled: 0,
      warnings: [],
      failed: [],
    };

    if (rows.length < 15) {
      result.warnings.push(
        `Only ${rows.length} students — fewer than 15 expected. Proceeding anyway.`,
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!emailRegex.test(row.email)) {
        result.failed.push({
          row: i + 2, // +2: 1-indexed + header row
          email: row.email,
          reason: 'Invalid email format',
        });
        continue;
      }

      // Find or create user
      let user = await this.userRepo.findOne({
        where: { email: row.email },
      });

      const isNewUser = !user;
      let tempPassword: string | undefined;

      if (!user) {
        tempPassword = randomBytes(4).toString('hex'); // 8-char alphanumeric
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        user = this.userRepo.create({
          email: row.email,
          student_id: row.student_id || null,
          full_name: row.full_name || null,
          password_hash: hashedPassword,
        });
        user = await this.userRepo.save(user);
        result.created++;
      }

      // Check if already enrolled
      const existingMembership = await this.classMembershipRepo.findOne({
        where: { class_id: classId, user_id: user.id },
      });

      if (existingMembership) {
        result.already_enrolled++;
        continue;
      }

      // Enroll
      const membership = this.classMembershipRepo.create({
        class_id: classId,
        user_id: user.id,
      });
      await this.classMembershipRepo.save(membership);
      result.enrolled++;

      // In-app notification (existing users only)
      if (!isNewUser) {
        const notification = this.notifRepo.create({
          user_id: user.id,
          title: `Enrolled in ${targetClass.code}`,
          message: `You have been enrolled in ${targetClass.name}. Enrollment key: ${targetClass.enrollment_key}`,
        });
        await this.notifRepo.save(notification);
      }

      // Queue email (all students)
      const emailContent = classEnrollmentEmail({
        className: targetClass.name,
        classCode: targetClass.code,
        semester: targetClass.semester,
        lecturerName: targetClass.lecturer?.full_name || 'Your Lecturer',
        enrollmentKey: targetClass.enrollment_key,
        tempPassword,
      });
      await this.mailService.queueEmail(
        row.email,
        emailContent.subject,
        emailContent.html,
      );
    }

    this.logger.log(
      `Import complete for class ${classId}: ${result.enrolled} enrolled, ${result.created} created, ${result.already_enrolled} skipped`,
    );

    return result;
  }
}
