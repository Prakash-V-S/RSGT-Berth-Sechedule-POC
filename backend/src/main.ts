import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const corsOrigin = configService.get<string>('cors.origin');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',') : true,
  });

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`RSGT Berth Schedule backend running on http://localhost:${port}/api`);
}

bootstrap();
