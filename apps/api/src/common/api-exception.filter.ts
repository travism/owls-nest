// Global exception filter — every error leaves the API in the same shape:
//   { error: { code, message, details? } }
//
// Domain code throws Nest HttpExceptions with a structured payload like
//   throw new BadRequestException({ code: 'VALIDATION_FAILED', message: ..., details: ... })
// → we pass that through unchanged.
//
// Third-party middleware (csrf-csrf, etc.) throws HttpExceptions with a bare
// `{statusCode, message}` shape → we map status → code based on the table below
// and, for 403s mentioning "csrf", emit CSRF_INVALID so clients can retry the token.
//
// Anything not derived from HttpException is logged and returned as a generic
// 500 with code INTERNAL_ERROR (no internals leaked).

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorCode } from '@owlsnest/shared';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = this.toEnvelope(exception, req);
    res.status(status).json(body);
  }

  private toEnvelope(
    exception: unknown,
    req: Request,
  ): { status: number; body: ErrorEnvelope } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      // Domain code path: structured payload with `code` already set.
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof (response as { code: unknown }).code === 'string'
      ) {
        const r = response as { code: string; message?: string; details?: unknown };
        return {
          status,
          body: {
            error: {
              code: r.code as ErrorCode,
              message: r.message ?? exception.message,
              ...(r.details !== undefined ? { details: r.details } : {}),
            },
          },
        };
      }

      // Bare {statusCode, message} from a third-party middleware or default Nest exception
      const message = this.extractMessage(response, exception);
      const code = this.codeFromStatusAndMessage(status, message);
      return {
        status,
        body: { error: { code, message } },
      };
    }

    // http-errors style (csrf-csrf, body-parser, etc.) — plain Error with
    // a numeric `status` or `statusCode` property attached. Convert to our
    // envelope using the same status → code mapping.
    const httpErrStatus = readHttpErrorStatus(exception);
    if (httpErrStatus !== null && exception instanceof Error) {
      const code = this.codeFromStatusAndMessage(httpErrStatus, exception.message);
      return {
        status: httpErrStatus,
        body: { error: { code, message: exception.message } },
      };
    }

    // Anything else — log full stack, return generic 500.
    this.log.error({ err: exception, path: req.path }, 'Unhandled exception');
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error.',
        },
      },
    };
  }

  private extractMessage(response: unknown, fallback: HttpException): string {
    if (typeof response === 'string') return response;
    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const m = (response as { message: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m) && m.length > 0 && typeof m[0] === 'string') return m[0];
    }
    return fallback.message;
  }

  private codeFromStatusAndMessage(status: number, message: string): ErrorCode {
    if (status === HttpStatus.FORBIDDEN && /csrf/i.test(message)) {
      return 'CSRF_INVALID';
    }
    return STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
  }
}

/**
 * Detects http-errors style errors (an Error with `.status` or `.statusCode`).
 * Returns the numeric status if found, else null.
 */
function readHttpErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = (err as { status?: unknown; statusCode?: unknown });
  const s = candidate.status ?? candidate.statusCode;
  return typeof s === 'number' && Number.isInteger(s) && s >= 400 && s < 600 ? s : null;
}
