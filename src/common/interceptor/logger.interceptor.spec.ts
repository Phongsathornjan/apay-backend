import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LoggerInterceptor } from './logger.interceptor';

describe('LoggerInterceptor', () => {
  const createContext = () => {
    const listeners: Record<string, () => void> = {};
    const req = {
      correlation_id: 'corr-log-1',
      method: 'POST',
      originalUrl: '/api/v1/auth/login',
      headers: {
        authorization: 'Bearer apay_live_1234567890abcdef',
        'content-type': 'application/json',
      },
      body: { username: 'merchant', phone: '0812345678' },
    };
    const res = {
      statusCode: 200,
      getHeaders: jest.fn(() => ({
        'content-type': 'application/json',
        'x-correlation-id': 'corr-log-1',
      })),
      on: jest.fn((event: string, cb: () => void) => {
        listeners[event] = cb;
      }),
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    return { context, res, listeners };
  };

  const getLogs = (spy: jest.SpyInstance) =>
    spy.mock.calls.map((call) => call[0] as Record<string, any>);

  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs request headers/body and response headers/body on success', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));
    listeners.finish?.();

    expect(result).toEqual({ ok: true });

    const [reqLog, resLog] = getLogs(logSpy);
    expect(reqLog).toMatchObject({
      correlation_id: 'corr-log-1',
      method: 'POST',
      path: '/api/v1/auth/login',
      req_headers: {
        authorization: 'Bearer a***cdef',
        'content-type': 'application/json',
      },
      req_body: { username: 'merchant', phone: '081XXX5678' },
      error: null,
    });
    expect(reqLog.statusCode).toBeUndefined();

    expect(resLog).toMatchObject({
      correlation_id: 'corr-log-1',
      statusCode: 200,
      res_headers: {
        'content-type': 'application/json',
        'x-correlation-id': 'corr-log-1',
      },
      res_body: { ok: true },
      error: null,
    });
  });

  it('logs the HttpException response body instead of null on error', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => throwError(() => new BadRequestException('Invalid input')),
    };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('Invalid input');

    listeners.finish?.();

    const resLog = getLogs(logSpy).at(-1);
    expect(resLog).toMatchObject({
      statusCode: 200,
      res_body: {
        ok: false,
        status: 400,
        correlation_id: 'corr-log-1',
        message: 'Invalid input',
      },
      error: {
        name: 'BadRequestException',
        message: 'Invalid input',
      },
    });
  });

  it('falls back to a generic 500 body for non-HttpExceptions', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('Something failed')),
    };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('Something failed');

    listeners.close?.();

    const resLog = getLogs(logSpy).at(-1);
    expect(resLog).toMatchObject({
      res_body: {
        ok: false,
        status: 500,
        correlation_id: 'corr-log-1',
        message: 'Internal server error',
      },
      error: { name: 'Error', message: 'Something failed' },
    });
  });

  it('keeps array validation messages from HttpException responses', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () =>
        throwError(
          () =>
            new BadRequestException({
              statusCode: 400,
              message: ['username should not be empty'],
              error: 'Bad Request',
            }),
        ),
    };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow();

    listeners.finish?.();

    const resLog = getLogs(logSpy).at(-1);
    expect(resLog?.res_body).toEqual({
      ok: false,
      status: 400,
      correlation_id: 'corr-log-1',
      message: ['username should not be empty'],
    });
  });

  it('logs the response only once when both finish and close fire', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    await firstValueFrom(interceptor.intercept(context, next));
    listeners.finish?.();
    listeners.close?.();
    listeners.finish?.();

    expect(getLogs(logSpy)).toHaveLength(2);
  });
});
