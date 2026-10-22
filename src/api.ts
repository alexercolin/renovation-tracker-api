import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { buildServer } from './server.js';

const env = loadEnv();
const container = createContainer(env);
const app = await buildServer(container);

await app.listen({ port: env.PORT, host: '0.0.0.0' });

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  container.logger.info({ signal }, 'api shutting down');
  await app.close();
  await container.close();
  process.exit(0);
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
