import { type JobFields, type Location } from './jobs.types.js';

export interface FieldChange<T> {
  before: T;
  after: T;
}

export type JobChanges = {
  [K in keyof JobFields]?: FieldChange<JobFields[K]>;
};

const locationKeys: ReadonlyArray<keyof Location> = [
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
];

export function sameLocation(a: Location, b: Location): boolean {
  return locationKeys.every((key) => a[key] === b[key]);
}

export function diffJobFields(current: JobFields, desired: Partial<JobFields>): JobChanges {
  const changes: JobChanges = {};

  if (desired.description !== undefined && desired.description !== current.description) {
    changes.description = { before: current.description, after: desired.description };
  }
  if (desired.location !== undefined && !sameLocation(desired.location, current.location)) {
    changes.location = { before: current.location, after: desired.location };
  }
  if (desired.status !== undefined && desired.status !== current.status) {
    changes.status = { before: current.status, after: desired.status };
  }
  if (desired.costCents !== undefined && desired.costCents !== current.costCents) {
    changes.costCents = { before: current.costCents, after: desired.costCents };
  }

  return changes;
}

export function hasChanges(changes: JobChanges): boolean {
  return Object.keys(changes).length > 0;
}
