import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpErrorFilter } from './exception.filter';

describe('HttpErrorFilter', () => {
  it('formats HttpException into standard error envelope', () => {
    const filter = new HttpErrorFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ correlation_id: 'corr-err-1' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new BadRequestException('Invalid input'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      status: 400,
      correlation_id: 'corr-err-1',
      message: 'Invalid input',
    });
  });
});
