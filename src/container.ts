import pino, { type Logger } from 'pino';

import { type Env } from './config/env.js';
import { createDb, type Db } from './db/client.js';
import { type AwsClients, createAwsClients } from './infra/aws.js';
import { PdfKitReportWriter } from './infra/pdf/report-pdf.js';
import { type MessageQueue } from './infra/queue/queue.js';
import { SqsQueue } from './infra/queue/sqs-queue.js';
import { S3Storage } from './infra/storage/s3-storage.js';
import { type ObjectStorage } from './infra/storage/storage.js';
import { AuthService } from './modules/auth/auth.service.js';
import { HistoryRepository } from './modules/history/history.repository.js';
import { HistoryService } from './modules/history/history.service.js';
import { JobsRepository } from './modules/jobs/jobs.repository.js';
import { JobsService } from './modules/jobs/jobs.service.js';
import { MessagesRepository } from './modules/messages/messages.repository.js';
import { MessagesService } from './modules/messages/messages.service.js';
import { ReportsRepository } from './modules/reports/reports.repository.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { UsersService } from './modules/users/users.service.js';

export interface Container {
  env: Env;
  logger: Logger;
  db: Db;
  queue: MessageQueue;
  storage: ObjectStorage;
  repositories: {
    users: UsersRepository;
    jobs: JobsRepository;
    messages: MessagesRepository;
    reports: ReportsRepository;
    history: HistoryRepository;
  };
  services: {
    users: UsersService;
    auth: AuthService;
    jobs: JobsService;
    messages: MessagesService;
    reports: ReportsService;
    history: HistoryService;
  };
  close(): Promise<void>;
}

export function createContainer(env: Env): Container {
  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const { db, pool } = createDb(env.DATABASE_URL);
  const aws: AwsClients = createAwsClients(env);
  const queue = new SqsQueue(aws.sqs, env.SQS_REPORTS_QUEUE_URL);
  const storage = new S3Storage(aws.s3, env.S3_REPORTS_BUCKET);

  const repositories = {
    users: new UsersRepository(),
    jobs: new JobsRepository(),
    messages: new MessagesRepository(),
    reports: new ReportsRepository(),
    history: new HistoryRepository(),
  };

  const users = new UsersService(db, repositories.users);
  const history = new HistoryService(db, repositories.history, repositories.jobs);
  const jobs = new JobsService(db, repositories.jobs, repositories.users, history);
  const messages = new MessagesService(db, repositories.messages, jobs);
  const services = {
    users,
    auth: new AuthService(db, repositories.users, {
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
    }),
    jobs,
    messages,
    reports: new ReportsService({
      db,
      reportsRepository: repositories.reports,
      jobsService: jobs,
      usersService: users,
      messagesService: messages,
      historyService: history,
      queue,
      storage,
      writer: new PdfKitReportWriter(),
    }),
    history,
  };

  return {
    env,
    logger,
    db,
    queue,
    storage,
    repositories,
    services,
    async close() {
      aws.destroy();
      await pool.end();
    },
  };
}
