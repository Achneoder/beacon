import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  type PipeTransform,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ACCEPTED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, type AcceptedDocumentType } from '@beacon/shared';

export interface UploadedDocumentFile {
  buffer: Buffer;
  size: number;
  /** The sniffed type — what actually gets stored, never the client's declared one. */
  contentType: AcceptedDocumentType;
  originalFilename: string;
  checksum: string;
}

const [PDF_TYPE, DOCX_TYPE, JPEG_TYPE] = ACCEPTED_DOCUMENT_TYPES;

/**
 * Content type is derived from the file's own bytes, never trusted from the client —
 * a spoofed `Content-Type` header must not decide what a browser is later told to
 * render. A `.pdf` renamed `.jpg` fails here rather than being served as one.
 */
function sniff(buffer: Buffer, declaredMimeType: string, filename: string): AcceptedDocumentType | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return PDF_TYPE;
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return JPEG_TYPE;
  }

  // A ZIP signature alone is not enough — plenty of formats are ZIPs underneath.
  // docx is accepted only when the client also declared the OOXML wordprocessing
  // type and named the file `.docx`; this is heuristic, not proof, and the crafted
  // case is stored inert and served only through a presigned download, never executed.
  const isZip =
    buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (isZip && declaredMimeType === DOCX_TYPE && filename.toLowerCase().endsWith('.docx')) {
    return DOCX_TYPE;
  }

  return null;
}

@Injectable()
export class DocumentFilePipe implements PipeTransform<Express.Multer.File | undefined, UploadedDocumentFile> {
  transform(file: Express.Multer.File | undefined): UploadedDocumentFile {
    if (!file) throw new BadRequestException('a file is required');

    // Belt and braces alongside the interceptor's own limit — this is the message a
    // client that streamed under that limit but still sent too much actually reads.
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new PayloadTooLargeException('the file exceeds the 20 MB limit');
    }

    // Display metadata only, reduced to a bare basename — it is never part of the
    // storage key, so nothing in it can traverse a path or cross a tenant.
    const originalFilename = basename(file.originalname).slice(0, 255);
    const contentType = sniff(file.buffer, file.mimetype, originalFilename);
    if (!contentType) {
      throw new UnsupportedMediaTypeException('only pdf, docx and jpg files are accepted');
    }

    return {
      buffer: file.buffer,
      size: file.size,
      contentType,
      originalFilename,
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }
}
