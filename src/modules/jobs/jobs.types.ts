import { z } from 'zod';

import { type JobRow, type JobStatus, jobStatus } from '../../db/schema/index.js';

export interface Location {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface JobFields {
  description: string;
  location: Location;
  status: JobStatus;
  costCents: number;
}

export interface Job extends JobFields {
  id: string;
  contractorId: string;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    contractorId: row.contractorId,
    description: row.description,
    location: {
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
    },
    status: row.status,
    costCents: row.costCents,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function locationToColumns(location: Location) {
  return {
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    country: location.country,
  };
}

const MAX_INT32 = 2_147_483_647;

const text = (max: number) => z.string().trim().min(1).max(max);

const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const locationSchema = z.object({
  addressLine1: text(200),
  addressLine2: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => (value ? value : null)),
  city: text(100),
  state: text(100),
  postalCode: text(20),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2)
    .nullish()
    .transform((value) => value ?? 'US'),
});

export const jobStatusSchema = z.enum(jobStatus.enumValues);

export const costCentsSchema = z.number().int().min(0).max(MAX_INT32);

export const createJobInputSchema = z.object({
  description: text(5000),
  location: locationSchema,
  status: optional(jobStatusSchema).transform((value) => value ?? 'PLANNING'),
  costCents: optional(costCentsSchema).transform((value) => value ?? 0),
});

const updatableFields = ['description', 'location', 'status', 'costCents'] as const;

export const updateJobInputSchema = z
  .object({
    description: optional(text(5000)),
    location: optional(locationSchema),
    status: optional(jobStatusSchema),
    costCents: optional(costCentsSchema),
    expectedVersion: optional(z.number().int().min(1)),
  })
  .refine((value) => updatableFields.some((field) => value[field] !== undefined), {
    message: 'Provide at least one field to update',
  });

export type CreateJobInput = z.infer<typeof createJobInputSchema>;
export type UpdateJobInput = z.infer<typeof updateJobInputSchema>;
