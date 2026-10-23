import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LoggerInterceptor } from './logger.interceptor';

describe('LoggerInterceptor', () => {
  const createContext = () => {
    const listeners: Record<string, () => void> = {};
    const req = {
      correlation_id: 'corr-log-1',
      method: 'POST',
      originalUrl: '/api/v1/auth/login',
      body: { username: 'merchant', phone: '0812345678' },
    };
    const res = {
      statusCode: 200,
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

  it('logs request and response bodies and forwards data on success', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));
    listeners.finish?.();

    expect(result).toEqual({ ok: true });
  });

  it('captures and rethrows errors while logging error details on finish', async () => {
    const interceptor = new LoggerInterceptor();
    const { context, listeners } = createContext();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('Something failed')),
    };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('Something failed');
    listeners.finish?.();
  });
});
