import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let webhookService: {
    verifyIosNotificationSecret: jest.Mock;
    handleIosNotification: jest.Mock;
  };

  beforeEach(async () => {
    webhookService = {
      verifyIosNotificationSecret: jest.fn(),
      handleIosNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: webhookService }],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('delegates a KBank iOS notification when the secret is valid', async () => {
    const body = {
      app: 'K_PLUS',
      title: 'รายการเงินเข้า',
      body: 'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
    };
    webhookService.verifyIosNotificationSecret.mockReturnValue(true);
    webhookService.handleIosNotification.mockResolvedValue({
      processed: 1,
      matched: true,
      order_id: '20261101_1.00',
    });

    const result = await controller.handleKbankIosNotification(body, 'secret');

    expect(webhookService.verifyIosNotificationSecret).toHaveBeenCalledWith(
      'secret',
    );
    expect(webhookService.handleIosNotification).toHaveBeenCalledWith(body);
    expect(result).toEqual({
      processed: 1,
      matched: true,
      order_id: '20261101_1.00',
    });
  });

  it('throws UnauthorizedException when the iOS webhook secret is invalid', () => {
    webhookService.verifyIosNotificationSecret.mockReturnValue(false);

    expect(() =>
      controller.handleKbankIosNotification({ body: 'เงินเข้า 1.00' }, 'bad'),
    ).toThrow(UnauthorizedException);
    expect(webhookService.handleIosNotification).not.toHaveBeenCalled();
  });
});
