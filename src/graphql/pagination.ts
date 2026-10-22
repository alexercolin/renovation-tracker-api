import { ValidationError } from '../shared/errors.js';
import { parseId } from '../shared/ids.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface PageArgs {
  first?: number | null;
  last?: number | null;
}

export function assertPageSize({ first, last }: PageArgs, max = MAX_PAGE_SIZE): void {
  for (const [name, value] of [
    ['first', first],
    ['last', last],
  ] as const) {
    if (value != null && value > max) {
      throw new ValidationError('Page size too large', [
        { path: name, message: `Must be at most ${max}` },
      ]);
    }
  }
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return parseId(Buffer.from(cursor, 'base64url').toString('utf8'), 'cursor');
}

export function encodeSeqCursor(seq: number): string {
  return Buffer.from(String(seq), 'utf8').toString('base64url');
}

export function decodeSeqCursor(cursor: string): number {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const seq = Number(decoded);
  if (!Number.isInteger(seq) || seq < 1 || String(seq) !== decoded) {
    throw new ValidationError('Invalid cursor', [
      { path: 'cursor', message: 'Cursor is not recognised' },
    ]);
  }
  return seq;
}
