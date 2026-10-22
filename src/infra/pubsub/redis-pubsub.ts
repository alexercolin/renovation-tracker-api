import { createRedisEventTarget } from '@graphql-yoga/redis-event-target';
import { createPubSub } from 'graphql-yoga';
import { Redis } from 'ioredis';

import { type RealtimePubSub, type RealtimeTopics } from './pubsub.js';

export interface RedisPubSubHandle {
  pubsub: RealtimePubSub;
  close(): Promise<void>;
}

export function createRedisPubSub(redisUrl: string): RedisPubSubHandle {
  const publishClient = new Redis(redisUrl);
  const subscribeClient = new Redis(redisUrl);
  const eventTarget = createRedisEventTarget({ publishClient, subscribeClient });

  return {
    pubsub: createPubSub<RealtimeTopics>({ eventTarget }),
    async close() {
      await Promise.all([publishClient.quit(), subscribeClient.quit()]);
    },
  };
}
