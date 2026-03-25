import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AuthProvider, Role, SemesterStatus } from '../common/enums';
import { ClassMembership } from '../entities/class-membership.entity';
import { Class } from '../entities/class.entity';
import { Group } from '../entities/group.entity';
import { Semester } from '../entities/semester.entity';
import { Topic } from '../entities/topic.entity';
import { User } from '../entities/user.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  console.log('Synchronizing database schema...');
  await dataSource.synchronize(false); // don't drop tables, just sync

  const userRepository = dataSource.getRepository(User);
  const semesterRepository = dataSource.getRepository(Semester);
  const classRepository = dataSource.getRepository(Class);
  const classMembershipRepository = dataSource.getRepository(ClassMembership);
  const groupRepository = dataSource.getRepository(Group);
  const topicRepository = dataSource.getRepository(Topic);

  console.log('Seeding default Admin...');
  let admin = await userRepository.findOne({
    where: { email: 'admin@edu.vn' },
  });
  if (!admin) {
    const salt = await bcrypt.genSalt();
    const passwordHash = await bcrypt.hash('password123', salt);
    admin = userRepository.create({
      email: 'admin@edu.vn',
      full_name: 'System Admin',
      password_hash: passwordHash,
      role: Role.ADMIN,
      primary_provider: AuthProvider.EMAIL,
      is_email_verified: true,
    });
    await userRepository.save(admin);
    console.log('Created default Admin account');
  } else {
    console.log('Default Admin already exists');
  }

  console.log('Seeding Mr.Teo (Lecturer)...');
  let lecturer = await userRepository.findOne({
    where: { email: 'mr.teo@edu.vn' },
  });
  if (!lecturer) {
    const salt = await bcrypt.genSalt();
    const passwordHash = await bcrypt.hash('password123', salt);
    lecturer = userRepository.create({
      email: 'mr.teo@edu.vn',
      full_name: 'Mr. Teo',
      password_hash: passwordHash,
      role: Role.LECTURER,
      primary_provider: AuthProvider.EMAIL,
      is_email_verified: true,
    });
    await userRepository.save(lecturer);
    console.log('Created Mr.Teo (Lecturer)');
  } else {
    console.log('Mr.Teo already exists');
  }

  console.log('Seeding 35 Students...');
  for (let i = 1; i <= 35; i++) {
    const email = `student${i}@edu.vn`;
    const existing = await userRepository.findOne({ where: { email } });
    if (!existing) {
      const salt = await bcrypt.genSalt();
      const passwordHash = await bcrypt.hash('password123', salt);
      const student = userRepository.create({
        email,
        full_name: `Student ${i}`,
        student_id: `HE1500${i.toString().padStart(2, '0')}`,
        password_hash: passwordHash,
        role: Role.STUDENT,
        primary_provider: AuthProvider.EMAIL,
        is_email_verified: true,
      });
      await userRepository.save(student);
    }
  }
  console.log('Created 35 Students');

  console.log('Seeding active semester SP26...');
  let semester = await semesterRepository.findOne({ where: { code: 'SP26' } });
  if (!semester) {
    semester = semesterRepository.create({
      code: 'SP26',
      name: 'Spring 2026',
      start_date: '2026-01-05',
      end_date: '2026-05-15',
      status: SemesterStatus.ACTIVE,
      current_week: 1,
    });
    semester = await semesterRepository.save(semester);
    console.log('Created semester SP26');
  } else {
    console.log('Semester SP26 already exists');
  }

  console.log('Seeding demo class SWP391...');
  let demoClass = await classRepository.findOne({
    where: { code: 'SWP391', semester: 'SP26' },
  });
  if (!demoClass) {
    demoClass = classRepository.create({
      code: 'SWP391',
      name: 'Software Project',
      semester: 'SP26',
      lecturer_id: lecturer.id,
      enrollment_key: 'DEMO26',
      max_groups: 7,
      max_students_per_group: 6,
    });
    demoClass = await classRepository.save(demoClass);
    console.log('Created demo class SWP391');
  } else {
    console.log('Demo class SWP391 already exists');
  }

  const existingGroups = await groupRepository.count({
    where: { class_id: demoClass.id },
  });
  if (existingGroups === 0) {
    await groupRepository.insert(
      Array.from({ length: 7 }).map((_, index) => ({
        name: `Group ${index + 1}`,
        class_id: demoClass!.id,
        created_by_id: lecturer.id,
        semester: 'SP26',
      })),
    );
    console.log('Created 7 demo groups for SWP391');
  } else {
    console.log('Demo groups already exist for SWP391');
  }

  const seededStudents = await userRepository.find({
    where: Array.from({ length: 35 }).map((_, index) => ({
      email: `student${index + 1}@edu.vn`,
    })),
  });
  for (const student of seededStudents) {
    const existingEnrollment = await classMembershipRepository.findOne({
      where: { class_id: demoClass.id, user_id: student.id },
    });

    if (!existingEnrollment) {
      await classMembershipRepository.save(
        classMembershipRepository.create({
          class_id: demoClass.id,
          user_id: student.id,
        }),
      );
    }
  }
  console.log('Ensured 35 students are enrolled in SWP391');

  console.log('Seeding 7 Default Topics...');
  const defaultTopics = [
    {
      name: 'E-commerce System',
      description: 'Build an e-commerce platform with NextJS and NestJS',
    },
    {
      name: 'Hotel Management',
      description: 'Manage hotel bookings, rooms, and staff',
    },
    {
      name: 'Online Learning Platform',
      description: 'Platform for courses, quizzes, and certificates',
    },
    {
      name: 'Hospitality Service',
      description: 'Restaurant booking and food delivery system',
    },
    {
      name: 'Real Estate Portal',
      description: 'Buy, rent, and sell properties',
    },
    {
      name: 'Healthcare System',
      description: 'Appointment booking and patient record management',
    },
    {
      name: 'Social Media App',
      description: 'Connect people, share posts, and chat messaging',
    },
  ];

  for (const t of defaultTopics) {
    const existing = await topicRepository.findOne({ where: { name: t.name } });
    if (!existing) {
      const topic = topicRepository.create(t);
      await topicRepository.save(topic);
    }
  }
  console.log('Created 7 Default Topics');

  console.log('Seed completed successfully!');
  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('Failed to seed database:', err);
  process.exit(1);
});
