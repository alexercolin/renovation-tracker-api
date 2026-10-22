import { type UserRow } from '../db/schema/index.js';
import { PdfKitReportWriter, type ReportWriter } from '../infra/pdf/report-pdf.js';
import { InMemoryQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryStorage } from '../infra/storage/in-memory-storage.js';
import { FakeHistoryRepository } from './history/history.repository.fake.js';
import { HistoryService } from './history/history.service.js';
import { fakeDb, FakeJobsRepository } from './jobs/jobs.repository.fake.js';
import { JobsService } from './jobs/jobs.service.js';
import { FakeMessagesRepository } from './messages/messages.repository.fake.js';
import { MessagesService } from './messages/messages.service.js';
import { FakeReportsRepository } from './reports/reports.repository.fake.js';
import { ReportsService, type ReportsServiceDeps } from './reports/reports.service.js';
import { FakeUsersRepository } from './users/users.repository.fake.js';
import { UsersService } from './users/users.service.js';

export interface FakeServicesOptions {
  users?: readonly UserRow[];
  writer?: ReportWriter;
}

export function createFakeServices({ users = [], writer }: FakeServicesOptions = {}) {
  const db = fakeDb();
  const repositories = {
    users: new FakeUsersRepository(users),
    jobs: new FakeJobsRepository(),
    messages: new FakeMessagesRepository(),
    reports: new FakeReportsRepository(),
    history: undefined as unknown as FakeHistoryRepository,
  };
  repositories.history = new FakeHistoryRepository(repositories.jobs);

  const queue = new InMemoryQueue();
  const storage = new InMemoryStorage();

  const usersService = new UsersService(db, repositories.users);
  const history = new HistoryService(db, repositories.history, repositories.jobs);
  const jobs = new JobsService(db, repositories.jobs, repositories.users, history);
  const messages = new MessagesService(db, repositories.messages, jobs);
  const reportsDeps: ReportsServiceDeps = {
    db,
    reportsRepository: repositories.reports,
    jobsService: jobs,
    usersService,
    messagesService: messages,
    historyService: history,
    queue,
    storage,
    writer: writer ?? new PdfKitReportWriter(),
  };

  return {
    db,
    repositories,
    queue,
    storage,
    reportsDeps,
    services: {
      users: usersService,
      history,
      jobs,
      messages,
      reports: new ReportsService(reportsDeps),
    },
  };
}
