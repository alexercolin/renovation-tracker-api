import { type Readable } from 'node:stream';

export interface ObjectStorage {
  upload(key: string, body: Readable, contentType: string): Promise<void>;
  presignedGetUrl(key: string, expiresInSeconds: number): Promise<string>;
}
