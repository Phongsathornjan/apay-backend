import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): object {
    return {
      service_name: 'backend-service',
      message: 'ok',
      timestamp: new Date().toISOString()
    }
  }
}
