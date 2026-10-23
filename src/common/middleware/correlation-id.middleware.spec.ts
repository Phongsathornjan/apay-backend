import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  RequestWithCorrelationId,
} from './correlation-id.middleware';

describe('correlationIdMiddleware', () => {
  it('uses existing x-correlation-id header when provided', () => {
    const req = {
      headers: { [CORRELATION_ID_HEADER]: 'corr-123' },
    } as unknown as RequestWithCorrelationId;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlation_id).toBe('corr-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      'corr-123',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses first header value when x-correlation-id is an array', () => {
    const req = {
      headers: { [CORRELATION_ID_HEADER]: ['corr-first', 'corr-second'] },
    } as unknown as RequestWithCorrelationId;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlation_id).toBe('corr-first');
  });

  it('generates a UUID when x-correlation-id header is absent', () => {
    const req = { headers: {} } as unknown as RequestWithCorrelationId;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlation_id).toEqual(expect.any(String));
    expect(req.correlation_id.length).toBeGreaterThan(10);
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      req.correlation_id,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
