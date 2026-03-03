import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { ClassModule } from './modules/class/class.module';
import { DocumentSubmissionModule } from './modules/document-submission/document-submission.module';
import { GithubModule } from './modules/github/github.module';
import { GroupsModule } from './modules/groups/groups.module';
import { JiraModule } from './modules/jira/jira.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ReportModule } from './modules/report/report.module';
import { TopicModule } from './modules/topic/topic.module';
import { UsersModule } from './modules/users/users.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        url: configService.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
    UsersModule,
    AuthModule,
    GroupsModule,
    GithubModule,
    JiraModule,
    ClassModule,
    NotificationModule,
    DocumentSubmissionModule,
    TopicModule,
    ReportModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
