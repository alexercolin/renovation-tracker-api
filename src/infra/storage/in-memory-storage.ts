import { type Readable } from 'node:stream';

import { type ObjectStorage } from './storage.js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export class InMemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  async upload(key: string, body: Readable, contentType: string): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
  }

  presignedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(`memory://${key}?expires=${expiresInSeconds}`);
  }
}
