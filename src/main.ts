import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getDocumentBuilder, swaggerUiOptions } from './swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);

    // Enable cookie parser middleware
    app.use(cookieParser());

    // Set global API prefix (exclude root / and /health)
    app.setGlobalPrefix('api', {
      exclude: ['/', 'health', 'health/ping'],
    });

    // Enable CORS with dynamic origins from environment variable
    const allowedOrigins = configService
      .get<string>('ALLOWED_CORS_ORIGINS')
      ?.split(',') || ['http://localhost:3000', 'http://localhost:5173'];

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn(`CORS blocked origin: ${origin}`);
          callback(null, false);
        }
      },
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true, // Allow cookies
      allowedHeaders: 'Content-Type,Authorization,Accept',
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // Swagger setup
    const swaggerConfig = getDocumentBuilder();
    const documentFactory = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, documentFactory, swaggerUiOptions);

    const port = configService.get<number>('PORT', 3000);

    await app.listen(port);

    logger.log(`Application is running on: http://localhost:${port}`);
    logger.log(`Swagger UI is available at: http://localhost:${port}/api/docs`);
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}
void bootstrap();
