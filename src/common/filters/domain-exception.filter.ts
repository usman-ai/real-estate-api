import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../errors/domain-error';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      res.status(exception.httpStatus).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = normalizeHttpBody(body, status, exception.message);
      res.status(status).json({ error: payload });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

function normalizeHttpBody(
  body: string | object,
  status: number,
  fallbackMessage: string,
): { code: string; message: string; details?: Record<string, unknown> } {
  if (typeof body === 'string') {
    return { code: httpCodeFor(status), message: body };
  }
  const b = body as Record<string, unknown>;
  const rawMessage = b['message'];
  if (Array.isArray(rawMessage)) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { validationErrors: rawMessage },
    };
  }
  return {
    code: httpCodeFor(status),
    message: (rawMessage as string) ?? fallbackMessage,
  };
}

function httpCodeFor(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE_ENTITY';
    default:  return `HTTP_${status}`;
  }
}
