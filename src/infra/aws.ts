import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

import { type Env } from '../config/env.js';

export interface AwsClients {
  sqs: SQSClient;
  s3: S3Client;
  destroy(): void;
}

export function createAwsClients(env: Env): AwsClients {
  const shared = {
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
  };
  const sqs = new SQSClient(shared);
  const s3 = new S3Client({ ...shared, forcePathStyle: env.AWS_ENDPOINT_URL !== undefined });

  return {
    sqs,
    s3,
    destroy() {
      sqs.destroy();
      s3.destroy();
    },
  };
}
