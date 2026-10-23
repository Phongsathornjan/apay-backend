import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let webhookService: {
    verifySignature: jest.Mock;
    handleWebhook: jest.Mock;
  };

  beforeEach(async () => {
    webhookService = {
      verifySignature: jest.fn(),
      handleWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: webhookService }],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('verifies signature and delegates valid webhook events to WebhookService', async () => {
    const rawBody = Buffer.from('{"events":[]}');
    const body = { events: [] };
    webhookService.verifySignature.mockReturnValue(true);
    webhookService.handleWebhook.mockResolvedValue({ processed: 1 });

    const result = await controller.handleKbankLineWebhook(
      { rawBody } as any,
      body,
      'sig-123',
    );

    expect(webhookService.verifySignature).toHaveBeenCalledWith(
      rawBody,
      'sig-123',
    );
    expect(webhookService.handleWebhook).toHaveBeenCalledWith(body);
    expect(result).toEqual({ processed: 1 });
  });

  it('throws UnauthorizedException when signature verification fails', () => {
    webhookService.verifySignature.mockReturnValue(false);

    expect(() =>
      controller.handleKbankLineWebhook(
        { rawBody: Buffer.from('{}') } as any,
        { events: [] },
        'bad-sig',
      ),
    ).toThrow(UnauthorizedException);
    expect(webhookService.handleWebhook).not.toHaveBeenCalled();
  });
});
