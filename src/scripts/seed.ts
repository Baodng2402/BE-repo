import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { DataSource, IsNull } from 'typeorm';
import { AppModule } from '../app.module';
import {
  AuthProvider,
  DocumentStatus,
  MembershipRole,
  ReviewMilestoneCode,
  Role,
  SemesterStatus,
  TaskJiraSyncStatus,
  TaskPriority,
  TaskStatus,
} from '../common/enums';
import { ClassMembership } from '../entities/class-membership.entity';
import { Class } from '../entities/class.entity';
import { DocumentSubmission } from '../entities/document-submission.entity';
import { GroupMembership } from '../entities/group-membership.entity';
import { GroupReview } from '../entities/group-review.entity';
import { Group } from '../entities/group.entity';
import { Semester } from '../entities/semester.entity';
import { Task } from '../entities/task.entity';
import { Topic } from '../entities/topic.entity';
import { User } from '../entities/user.entity';

const ADMIN_LECTURER_SEED_PASSWORD = '123123123';
const STUDENT_SEED_PASSWORD = 'password123';

async function hashPassword(plainTextPassword: string) {
  const salt = await bcrypt.genSalt();
  return bcrypt.hash(plainTextPassword, salt);
}

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
  const groupMembershipRepository = dataSource.getRepository(GroupMembership);
  const taskRepository = dataSource.getRepository(Task);
  const groupReviewRepository = dataSource.getRepository(GroupReview);
  const documentSubmissionRepository =
    dataSource.getRepository(DocumentSubmission);
  const topicRepository = dataSource.getRepository(Topic);

  console.log('Seeding default Admin...');
  let admin = await userRepository.findOne({
    where: { email: 'admin@edu.vn' },
  });
  const adminPasswordHash = await hashPassword(ADMIN_LECTURER_SEED_PASSWORD);
  if (!admin) {
    admin = userRepository.create({
      email: 'admin@edu.vn',
      full_name: 'System Admin',
      password_hash: adminPasswordHash,
      role: Role.ADMIN,
      primary_provider: AuthProvider.EMAIL,
      is_email_verified: true,
    });
    console.log('Created default Admin account');
  } else {
    admin.password_hash = adminPasswordHash;
    console.log('Default Admin already exists - password reset to seed value');
  }
  await userRepository.save(admin);

  console.log('Seeding Mr.Teo (Lecturer)...');
  let lecturer = await userRepository.findOne({
    where: { email: 'mr.teo@edu.vn' },
  });
  const lecturerPasswordHash = await hashPassword(ADMIN_LECTURER_SEED_PASSWORD);
  if (!lecturer) {
    lecturer = userRepository.create({
      email: 'mr.teo@edu.vn',
      full_name: 'Mr. Teo',
      password_hash: lecturerPasswordHash,
      role: Role.LECTURER,
      primary_provider: AuthProvider.EMAIL,
      is_email_verified: true,
    });
    console.log('Created Mr.Teo (Lecturer)');
  } else {
    lecturer.password_hash = lecturerPasswordHash;
    console.log('Mr.Teo already exists - password reset to seed value');
  }
  await userRepository.save(lecturer);

  console.log('Seeding 35 Students...');
  for (let i = 1; i <= 35; i++) {
    const email = `student${i}@edu.vn`;
    const existing = await userRepository.findOne({ where: { email } });
    if (!existing) {
      const passwordHash = await hashPassword(STUDENT_SEED_PASSWORD);
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

  seededStudents.sort((first, second) =>
    first.email.localeCompare(second.email),
  );

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

  const demoGroups = await groupRepository.find({
    where: { class_id: demoClass.id },
    order: { name: 'ASC' },
  });

  if (demoGroups.length === 0) {
    throw new Error('Demo groups are missing. Cannot continue seeding.');
  }

  for (let index = 0; index < seededStudents.length; index++) {
    const student = seededStudents[index];
    const targetGroup = demoGroups[index % demoGroups.length];
    const desiredRole =
      index < demoGroups.length ? MembershipRole.LEADER : MembershipRole.MEMBER;

    const existingGroupMembership = await groupMembershipRepository.findOne({
      where: {
        group_id: targetGroup.id,
        user_id: student.id,
      },
    });

    if (!existingGroupMembership) {
      await groupMembershipRepository.save(
        groupMembershipRepository.create({
          group_id: targetGroup.id,
          user_id: student.id,
          role_in_group: desiredRole,
          left_at: null,
        }),
      );
      continue;
    }

    existingGroupMembership.role_in_group = desiredRole;
    existingGroupMembership.left_at = null;
    await groupMembershipRepository.save(existingGroupMembership);
  }
  console.log('Assigned demo students into 7 groups with designated leaders');

  for (const [groupIndex, group] of demoGroups.entries()) {
    const activeMembers = await groupMembershipRepository.find({
      where: {
        group_id: group.id,
        left_at: IsNull(),
      },
      order: { joined_at: 'ASC' },
    });

    const defaultAssigneeId = activeMembers[0]?.user_id || null;
    const groupLeaderId =
      activeMembers.find(
        (membership) => membership.role_in_group === MembershipRole.LEADER,
      )?.user_id || defaultAssigneeId;

    const demoTasks = [
      {
        title: `[${group.name}] Scope & backlog draft`,
        description:
          'Define user stories and backlog for the first checkpoint.',
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        assignee_id: defaultAssigneeId,
      },
      {
        title: `[${group.name}] SRS structure implementation`,
        description:
          'Prepare SRS sections and map each feature to requirements.',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        assignee_id: defaultAssigneeId,
      },
      {
        title: `[${group.name}] Checkpoint 1 rehearsal`,
        description:
          'Complete deliverables and rehearse checkpoint presentation.',
        status: TaskStatus.DONE,
        priority: TaskPriority.HIGH,
        assignee_id: defaultAssigneeId,
      },
    ];

    for (const taskData of demoTasks) {
      const existingTask = await taskRepository.findOne({
        where: {
          group_id: group.id,
          title: taskData.title,
        },
      });

      if (existingTask) {
        continue;
      }

      await taskRepository.save(
        taskRepository.create({
          group_id: group.id,
          title: taskData.title,
          description: taskData.description,
          status: taskData.status,
          priority: taskData.priority,
          assignee_id: taskData.assignee_id,
          created_by_id: lecturer.id,
          jira_sync_status: TaskJiraSyncStatus.SKIPPED,
          jira_sync_reason: 'NO_PROJECT_KEY',
        }),
      );
    }

    const totalTasks = await taskRepository.count({
      where: { group_id: group.id },
    });
    const doneTasks = await taskRepository.count({
      where: {
        group_id: group.id,
        status: TaskStatus.DONE,
      },
    });

    const reviewScoreBase = 7 + (groupIndex % 3);
    const existingReview = await groupReviewRepository.findOne({
      where: {
        semester_id: semester.id,
        group_id: group.id,
        milestone_code: ReviewMilestoneCode.REVIEW_1,
      },
    });

    await groupReviewRepository.save(
      groupReviewRepository.create({
        id: existingReview?.id,
        semester_id: semester.id,
        group_id: group.id,
        milestone_code: ReviewMilestoneCode.REVIEW_1,
        week_start: 1,
        week_end: 3,
        task_progress_score: reviewScoreBase,
        commit_contribution_score: reviewScoreBase - 0.5,
        review_milestone_score: reviewScoreBase + 0.5,
        lecturer_note: `Demo seed review for ${group.name}`,
        snapshot_task_total: totalTasks,
        snapshot_task_done: doneTasks,
        snapshot_commit_total: 0,
        snapshot_commit_contributors: 0,
        snapshot_repository: null,
        snapshot_captured_at: new Date(),
        is_published: false,
        updated_by_id: lecturer.id,
      }),
    );

    if (!groupLeaderId) {
      continue;
    }

    const submissionTitle = `SRS ${group.name} v1`;
    const existingSubmission = await documentSubmissionRepository.findOne({
      where: {
        group_id: group.id,
        title: submissionTitle,
      },
    });

    if (!existingSubmission) {
      await documentSubmissionRepository.save(
        documentSubmissionRepository.create({
          group_id: group.id,
          submitted_by_id: groupLeaderId,
          title: submissionTitle,
          document_url: `https://demo.docs.local/${group.id}/srs-v1`,
          status:
            groupIndex % 3 === 0
              ? DocumentStatus.GRADED
              : DocumentStatus.PENDING,
          score: groupIndex % 3 === 0 ? 8 + (groupIndex % 2) : null,
          feedback:
            groupIndex % 3 === 0
              ? 'Demo graded submission for lecturer walkthrough.'
              : null,
        }),
      );
    }
  }

  console.log(
    'Seeded lecturer demo artifacts: tasks, reviews, and SRS submissions',
  );

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
