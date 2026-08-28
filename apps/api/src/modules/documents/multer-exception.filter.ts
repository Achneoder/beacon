import {
  BadRequestException,
  Catch,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import multer from 'multer';

/**
 * `FileInterceptor`'s own size limit throws a raw `MulterError`, which Nest would
 * otherwise turn into an unhandled 500. Mapped to the same lowercase, bare-message
 * shape as every other refusal, so the web's refusal table can match it.
 */
@Catch(multer.MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: InstanceType<typeof multer.MulterError>, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped =
      error.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException('the file exceeds the 20 MB limit')
        : new BadRequestException('the upload could not be read');

    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}
