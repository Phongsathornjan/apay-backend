import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { correlation_id?: string }>();
    const res = ctx.getResponse<Response>();

    res.status(exception.getStatus()).json({
      ok: false,
      status: exception.getStatus(),
      correlation_id: req.correlation_id,
      message: exception.message,
    });
  }
}