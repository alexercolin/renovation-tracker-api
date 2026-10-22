import { type GraphQLError } from 'graphql';
import { createGraphQLError, maskError as defaultMaskError } from 'graphql-yoga';

import { DomainError } from '../shared/errors.js';

function asGraphQLError(error: unknown): GraphQLError | undefined {
  return error instanceof Error && error.name === 'GraphQLError' && 'originalError' in error
    ? (error as GraphQLError)
    : undefined;
}

export function maskError(error: unknown, message: string, isDev?: boolean): Error {
  const graphqlError = asGraphQLError(error);
  const original = graphqlError?.originalError ?? error;

  if (original instanceof DomainError) {
    return createGraphQLError(original.message, {
      nodes: graphqlError?.nodes,
      path: graphqlError?.path,
      extensions: { code: original.code, ...original.details },
    });
  }

  if (original instanceof Error && original.name === 'PothosValidationError') {
    return createGraphQLError(original.message, {
      nodes: graphqlError?.nodes,
      path: graphqlError?.path,
      extensions: { code: 'VALIDATION' },
    });
  }

  return defaultMaskError(error, message, isDev);
}
