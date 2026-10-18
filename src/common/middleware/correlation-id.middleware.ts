import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export type RequestWithCorrelationId = Request & { correlation_id: string };

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers[CORRELATION_ID_HEADER];
  const correlation_id =
    (Array.isArray(header) ? header[0] : header) || randomUUID();

  (req as RequestWithCorrelationId).correlation_id = correlation_id;
  res.setHeader(CORRELATION_ID_HEADER, correlation_id);

  next();
}
