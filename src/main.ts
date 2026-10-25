
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { HttpErrorFilter } from './common/filters/exception.filter';
import { buildCorsOptions } from './common/config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors(buildCorsOptions());

  app.use(correlationIdMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpErrorFilter());

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
  });
  
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
