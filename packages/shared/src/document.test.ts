import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_CATEGORIES,
  documentKindOf,
  formatFileSize,
  isAcceptedDocumentType,
} from './document.js';

describe('formatFileSize', () => {
  it('writes bytes bare below a kilobyte', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('switches to KB at 1024 bytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(812 * 1024)).toBe('812 KB');
  });

  it('keeps one decimal once the value drops under 10 of a unit', () => {
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });

  it('drops the decimal at 10 units and above', () => {
    expect(formatFileSize(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('documentKindOf', () => {
  it('classifies the three accepted types', () => {
    expect(documentKindOf('application/pdf')).toBe('pdf');
    expect(
      documentKindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(documentKindOf('image/jpeg')).toBe('image');
  });

  it('falls back to other for anything else', () => {
    expect(documentKindOf('text/plain')).toBe('other');
  });
});

describe('isAcceptedDocumentType', () => {
  it('accepts exactly the three sniffed types', () => {
    expect(isAcceptedDocumentType('application/pdf')).toBe(true);
    expect(isAcceptedDocumentType('image/jpeg')).toBe(true);
    expect(isAcceptedDocumentType('text/plain')).toBe(false);
  });
});

describe('DEFAULT_DOCUMENT_CATEGORIES', () => {
  it('names the six categories the canvas draws', () => {
    expect(DEFAULT_DOCUMENT_CATEGORIES.map((category) => category.key)).toEqual([
      'employment-contract',
      'payslips',
      'certificates',
      'id-permits',
      'signed-policies',
      'sick-notes',
    ]);
  });
});
