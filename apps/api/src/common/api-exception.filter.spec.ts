import {
  ApiExceptionFilter,
} from './api-exception.filter';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

function fakeHost(): {
  host: ArgumentsHost;
  res: { status: jest.Mock; json: jest.Mock; sentStatus: number; sentBody: any };
} {
  let sentStatus = 0;
  let sentBody: any = null;
  const json = jest.fn((b) => {
    sentBody = b;
  });
  const status = jest.fn((s: number) => {
    sentStatus = s;
    return { json };
  });
  const res = { status, json, get sentStatus() { return sentStatus; }, get sentBody() { return sentBody; } };
  const req = { path: '/api/v1/test' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

function getEnvelope(res: ReturnType<typeof fakeHost>['res']): { status: number; body: any } {
  return { status: res.sentStatus, body: res.sentBody };
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  it('passes through structured domain payload (BadRequestException with code)', () => {
    const { host, res } = fakeHost();
    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid request body.',
        details: { email: ['Required'] },
      }),
      host,
    );
    const { status, body } = getEnvelope(res);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request body.',
        details: { email: ['Required'] },
      },
    });
  });

  it('maps a bare 401 (UnauthorizedException) to UNAUTHENTICATED', () => {
    const { host, res } = fakeHost();
    filter.catch(new UnauthorizedException(), host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.error.message).toBe('string');
  });

  it('maps a bare 403 (ForbiddenException) to FORBIDDEN', () => {
    const { host, res } = fakeHost();
    filter.catch(new ForbiddenException(), host);
    expect(getEnvelope(res).body.error.code).toBe('FORBIDDEN');
  });

  it('maps a 403 with a "csrf" message to CSRF_INVALID', () => {
    const { host, res } = fakeHost();
    filter.catch(new ForbiddenException('invalid csrf token'), host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(403);
    expect(body.error.code).toBe('CSRF_INVALID');
    expect(body.error.message).toBe('invalid csrf token');
  });

  it('maps NotFoundException to NOT_FOUND', () => {
    const { host, res } = fakeHost();
    filter.catch(new NotFoundException(), host);
    expect(getEnvelope(res).body.error.code).toBe('NOT_FOUND');
  });

  it('handles raw HttpException with string response', () => {
    const { host, res } = fakeHost();
    filter.catch(new HttpException('some message', HttpStatus.CONFLICT), host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('some message');
  });

  it('handles BadRequestException without a code (auto-mapped via class-validator etc.)', () => {
    const { host, res } = fakeHost();
    filter.catch(new BadRequestException('field is required'), host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('field is required');
  });

  it('returns generic 500 INTERNAL_ERROR for unknown errors and does not leak details', () => {
    const { host, res } = fakeHost();
    filter.catch(new Error('database password leaked'), host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('database password');
  });

  it('does not include details key when none provided', () => {
    const { host, res } = fakeHost();
    filter.catch(
      new ForbiddenException({ code: 'FORBIDDEN', message: 'Nope.' }),
      host,
    );
    const { body } = getEnvelope(res);
    expect(body.error).not.toHaveProperty('details');
  });

  it('handles http-errors style (csrf-csrf): Error with .status property', () => {
    const { host, res } = fakeHost();
    const err = Object.assign(new Error('invalid csrf token'), { status: 403, statusCode: 403 });
    filter.catch(err, host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(403);
    expect(body.error.code).toBe('CSRF_INVALID');
    expect(body.error.message).toBe('invalid csrf token');
  });

  it('handles http-errors with non-csrf message', () => {
    const { host, res } = fakeHost();
    const err = Object.assign(new Error('unauthorized'), { statusCode: 401 });
    filter.catch(err, host);
    const { status, body } = getEnvelope(res);
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('handles array message format from BadRequestException (class-validator style)', () => {
    const { host, res } = fakeHost();
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['name should not be empty', 'email must be a valid email'],
        error: 'Bad Request',
      } as any),
      host,
    );
    const { status, body } = getEnvelope(res);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('name should not be empty');
  });
});
