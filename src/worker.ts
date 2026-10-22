import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { runReportWorker } from './modules/reports/reports.worker.js';

const env = loadEnv();
const container = createContainer(env);
const controller = new AbortController();

function stop(signal: NodeJS.Signals): void {
  if (controller.signal.aborted) return;
  container.logger.info({ signal }, 'worker shutting down');
  controller.abort();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await runReportWorker(
  { queue: container.queue, reports: container.services.reports, logger: container.logger },
  controller.signal,
);
await container.close();
process.exit(0);
