import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

const DEFAULT_SMTP_PORT = 587;
const SMTP_TIMEOUT_MS = 10_000;

export interface SendOtpEmailParams {
  to: string;
  code: string;
  expiresInMinutes: number;
}

/**
 * ส่งอีเมลผ่าน SMTP โดยอ่านค่าจาก `.env`:
 * `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
 * `SMTP_FROM`, `SMTP_FROM_NAME`
 *
 * Transporter ถูกสร้างครั้งแรกที่ใช้งาน (lazy) เพื่อให้แอปยังบูตได้
 * แม้ยังไม่ได้ตั้งค่า SMTP (จะ error เฉพาะตอนเรียกส่งอีเมล)
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.getHost() && this.getFromAddress());
  }

  async sendBusinessOtpEmail({
    to,
    code,
    expiresInMinutes,
  }: SendOtpEmailParams): Promise<void> {
    const transporter = this.getTransporter();
    const fromAddress = this.getFromAddress();
    const fromName = this.configService.get<string>('SMTP_FROM_NAME')?.trim();
    const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    const text = [
      'APay - รหัสยืนยันอีเมลสำหรับสมัครบัญชีธุรกิจ',
      '',
      `รหัส OTP ของคุณคือ: ${code}`,
      `รหัสนี้จะหมดอายุใน ${expiresInMinutes} นาที`,
      '',
      'หากคุณไม่ได้เป็นผู้ขอรหัสนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้',
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2 style="margin: 0 0 12px;">APay - ยืนยันอีเมลสำหรับสมัครบัญชีธุรกิจ</h2>
        <p>รหัส OTP ของคุณคือ:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 16px 0;">${code}</p>
        <p>รหัสนี้จะหมดอายุใน <strong>${expiresInMinutes} นาที</strong></p>
        <p style="color: #666;">หากคุณไม่ได้เป็นผู้ขอรหัสนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from,
        to,
        subject: `APay OTP: ${code}`,
        text,
        html,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send OTP email to ${to}: ${(error as Error).message}`,
      );

      throw new ServiceUnavailableException(
        'Unable to send verification email; please try again later',
      );
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email service is not configured (SMTP_HOST / SMTP_FROM)',
      );
    }

    const parsedPort = Number(
      this.configService.get<string>('SMTP_PORT') ?? DEFAULT_SMTP_PORT,
    );
    const port = Number.isInteger(parsedPort)
      ? parsedPort
      : DEFAULT_SMTP_PORT;
    const secure =
      this.configService.get<string>('SMTP_SECURE')?.trim().toLowerCase() ===
        'true' || port === 465;
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS');

    this.transporter = createTransport({
      host: this.getHost(),
      port,
      secure,
      auth: user ? { user, pass: pass ?? '' } : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    return this.transporter;
  }

  private getHost(): string {
    return this.configService.get<string>('SMTP_HOST')?.trim() ?? '';
  }

  private getFromAddress(): string {
    const from = this.configService.get<string>('SMTP_FROM')?.trim();

    return from || (this.configService.get<string>('SMTP_USER')?.trim() ?? '');
  }
}
