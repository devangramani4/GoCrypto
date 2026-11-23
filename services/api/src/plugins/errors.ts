import type { ApiErrorBody } from '@gocrypto/shared-types';
import { AppError, isCheckConstraintError } from '@gocrypto/server-core';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

/** Uniform error envelope: { error: { code, message, details }, requestId }. Internals are never leaked. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    let status = 500;
    let body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: req.id };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details }, requestId: req.id };
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.validation.map((v) => ({
            path: v.instancePath || (v.params as { issue?: { path?: (string | number)[] } } | undefined)?.issue?.path?.join('.'),
            message: v.message,
          })),
        },
        requestId: req.id,
      };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: err.issues }, requestId: req.id };
    } else if (isCheckConstraintError(err)) {
      status = 422;
      body = { error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' }, requestId: req.id };
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      status = (err as FastifyError).statusCode!;
      const code = status === 429 ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHORIZED' : status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
      body = { error: { code, message: err.message }, requestId: req.id };
    }
    if (status >= 500) req.log.error({ err }, 'request failed');
    else req.log.debug({ code: body.error.code }, 'request rejected');
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` }, requestId: req.id });
  });
}
