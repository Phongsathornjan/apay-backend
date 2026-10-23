import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  it('wraps controller return data into standard response envelope', async () => {
    const interceptor = new ResponseInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ correlation_id: 'corr-1' }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = {
      handle: () => of({ hello: 'world' }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({
      ok: true,
      status: 200,
      correlation_id: 'corr-1',
      data: { hello: 'world' },
    });
  });
});
