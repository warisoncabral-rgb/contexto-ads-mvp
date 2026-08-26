import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1');
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
