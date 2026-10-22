import { describe, expect, it } from 'vitest';

import { diffJobFields, hasChanges } from './jobs.diff.js';
import { type JobFields } from './jobs.types.js';

const current: JobFields = {
  description: 'Kitchen remodel',
  location: {
    addressLine1: '1 Main St',
    addressLine2: null,
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  },
  status: 'PLANNING',
  costCents: 10_000,
};

describe('diffJobFields', () => {
  it('returns no changes when nothing differs or nothing is provided', () => {
    expect(hasChanges(diffJobFields(current, {}))).toBe(false);
    expect(hasChanges(diffJobFields(current, { ...current }))).toBe(false);
  });

  it('records before and after only for fields that changed', () => {
    const changes = diffJobFields(current, { costCents: 12_000, status: 'PLANNING' });

    expect(changes).toEqual({ costCents: { before: 10_000, after: 12_000 } });
  });

  it('treats location as one composite field', () => {
    const changes = diffJobFields(current, {
      location: { ...current.location, addressLine2: 'Unit 4' },
    });

    expect(Object.keys(changes)).toEqual(['location']);
    expect(changes.location?.before.addressLine2).toBeNull();
    expect(changes.location?.after.addressLine2).toBe('Unit 4');
  });
});
