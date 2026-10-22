import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { ValidationError } from './errors.js';

const idSchema = z.uuid();

export function newId(): string {
  return uuidv7();
}

export function parseId(value: string, field = 'id'): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Invalid identifier', [{ path: field, message: 'Must be a UUID' }]);
  }
  return parsed.data;
}
