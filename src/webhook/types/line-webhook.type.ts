export interface LineWebhookMessage {
  type: 'text' | 'image' | 'video' | string;
  id: string;
  text?: string;
}

export interface LineWebhookEvent {
  type: string;
  message?: LineWebhookMessage;
  timestamp?: number;
  source?: {
    type?: string;
    userId?: string;
  };
}

export interface LineWebhookBody {
  destination?: string;
  events?: LineWebhookEvent[];
}
