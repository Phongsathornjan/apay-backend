import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { correlation_id?: string }>();
    const res = http.getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        ok: true,
        status: res.statusCode,
        correlation_id: req.correlation_id,
        data,
      })),
    );
  }
}
