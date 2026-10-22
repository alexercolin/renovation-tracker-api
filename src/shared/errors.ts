import { type ZodError } from 'zod';

export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to perform this action') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', `${entity} not found`, id === undefined ? undefined : { entity, id });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, issues: ValidationIssue[] = []) {
    super('VALIDATION', message, { issues });
  }

  static fromZod(error: ZodError, message = 'Invalid input'): ValidationError {
    return new ValidationError(
      message,
      error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
