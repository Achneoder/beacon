import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { MAX_DOCUMENT_BYTES } from '@beacon/shared';
import { DocumentFilePipe } from './document-file.pipe.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fileFrom(overrides: Partial<Express.Multer.File> & { buffer: Buffer }): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'upload',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: overrides.buffer.length,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('DocumentFilePipe', () => {
  const pipe = new DocumentFilePipe();

  it('refuses a missing file', () => {
    expect(() => pipe.transform(undefined)).toThrow('a file is required');
  });

  it('sniffs a PDF regardless of the declared content type', () => {
    const buffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('rest of file')]);
    const result = pipe.transform(
      fileFrom({ buffer, mimetype: 'image/jpeg', originalname: 'contract.pdf' }),
    );

    expect(result.contentType).toBe('application/pdf');
    expect(result.checksum).toBe(createHash('sha256').update(buffer).digest('hex'));
  });

  it('sniffs a JPEG even when the client declares something else', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const result = pipe.transform(
      fileFrom({ buffer, mimetype: 'application/pdf', originalname: 'photo.jpeg' }),
    );

    expect(result.contentType).toBe('image/jpeg');
  });

  it('accepts a docx only with the ZIP signature, the OOXML mimetype and a .docx name', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const result = pipe.transform(fileFrom({ buffer, mimetype: DOCX_TYPE, originalname: 'contract.docx' }));

    expect(result.contentType).toBe(DOCX_TYPE);
  });

  it('rejects a ZIP-signed file that is not declared and named as docx', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

    expect(() =>
      pipe.transform(fileFrom({ buffer, mimetype: 'application/zip', originalname: 'archive.zip' })),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('rejects a text file renamed to look like a pdf', () => {
    const buffer = Buffer.from('just some text, not a pdf at all');

    expect(() =>
      pipe.transform(fileFrom({ buffer, mimetype: 'application/pdf', originalname: 'fake.pdf' })),
    ).toThrow('only pdf, docx and jpg files are accepted');
  });

  it('rejects a file over the 20 MB cap even if multer let it through', () => {
    const buffer = Buffer.from('%PDF-1.4\n');
    const file = fileFrom({ buffer, originalname: 'contract.pdf', mimetype: 'application/pdf' });
    file.size = MAX_DOCUMENT_BYTES + 1;

    expect(() => pipe.transform(file)).toThrow(PayloadTooLargeException);
  });

  it('reduces the display filename to a sanitized basename', () => {
    const buffer = Buffer.from('%PDF-1.4\n');
    const result = pipe.transform(
      fileFrom({ buffer, mimetype: 'application/pdf', originalname: '../../etc/passwd.pdf' }),
    );

    expect(result.originalFilename).toBe('passwd.pdf');
  });
});
