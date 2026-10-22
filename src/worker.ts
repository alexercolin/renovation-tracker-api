import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';

const env = loadEnv();
const container = createContainer(env);

container.logger.info('worker started; queue consumers are registered by feature modules');

const keepAlive = setInterval(() => undefined, 60_000);

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  container.logger.info({ signal }, 'worker shutting down');
  clearInterval(keepAlive);
  await container.close();
  process.exit(0);
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
