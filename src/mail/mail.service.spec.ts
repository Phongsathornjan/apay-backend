import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const createTransportMock = createTransport as jest.MockedFunction<
  typeof createTransport
>;

describe('MailService', () => {
  let service: MailService;
  let config: Record<string, string | undefined>;

  const sendMail = jest.fn();
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    config = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'mailer@example.com',
      SMTP_PASS: 'smtp-secret',
      SMTP_FROM: 'no-reply@example.com',
      SMTP_FROM_NAME: 'APay',
    };

    sendMail.mockResolvedValue({});
    createTransportMock.mockReturnValue({ sendMail } as never);

    service = new MailService(configService as unknown as ConfigService);
  });

  it('reports configured when SMTP host and from address are present', () => {
    expect(service.isConfigured()).toBe(true);
  });

  it('reports not configured when SMTP host is missing', () => {
    config.SMTP_HOST = '';

    expect(service.isConfigured()).toBe(false);
  });

  it('sends the OTP email with the configured SMTP settings', async () => {
    await service.sendBusinessOtpEmail({
      to: 'owner@example.com',
      code: '123456',
      expiresInMinutes: 10,
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'mailer@example.com', pass: 'smtp-secret' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"APay" <no-reply@example.com>',
        to: 'owner@example.com',
        subject: 'APay OTP: 123456',
        text: expect.stringContaining('123456'),
        html: expect.stringContaining('123456'),
      }),
    );
  });

  it('uses SMTP_USER as the from address when SMTP_FROM is not set', async () => {
    config.SMTP_FROM = undefined;
    config.SMTP_FROM_NAME = undefined;

    await service.sendBusinessOtpEmail({
      to: 'owner@example.com',
      code: '654321',
      expiresInMinutes: 5,
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'mailer@example.com' }),
    );
  });

  it('uses secure transport when SMTP_SECURE=true', async () => {
    config.SMTP_SECURE = 'true';
    config.SMTP_PORT = '465';

    await service.sendBusinessOtpEmail({
      to: 'owner@example.com',
      code: '111111',
      expiresInMinutes: 10,
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it('skips auth when SMTP_USER is not configured', async () => {
    config.SMTP_USER = undefined;
    config.SMTP_PASS = undefined;

    await service.sendBusinessOtpEmail({
      to: 'owner@example.com',
      code: '222222',
      expiresInMinutes: 10,
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('creates the transporter only once across calls', async () => {
    await service.sendBusinessOtpEmail({
      to: 'a@example.com',
      code: '123456',
      expiresInMinutes: 10,
    });
    await service.sendBusinessOtpEmail({
      to: 'b@example.com',
      code: '654321',
      expiresInMinutes: 10,
    });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('throws ServiceUnavailableException when SMTP is not configured', async () => {
    config.SMTP_HOST = '';
    config.SMTP_FROM = '';

    await expect(
      service.sendBusinessOtpEmail({
        to: 'owner@example.com',
        code: '123456',
        expiresInMinutes: 10,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('wraps SMTP send failures into ServiceUnavailableException', async () => {
    sendMail.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      service.sendBusinessOtpEmail({
        to: 'owner@example.com',
        code: '123456',
        expiresInMinutes: 10,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
