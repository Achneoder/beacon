import { describe, expect, it } from 'vitest';
import { attachmentDisposition } from './content-disposition.js';

describe('attachmentDisposition', () => {
  it('sends the plain name in both forms', () => {
    expect(attachmentDisposition('contract.pdf')).toBe(
      `attachment; filename="contract.pdf"; filename*=UTF-8''contract.pdf`,
    );
  });

  it('cannot be broken out of by a quote in the filename', () => {
    const header = attachmentDisposition('a"; filename="evil.exe');

    expect(header.startsWith('attachment; filename="a_; filename=_evil.exe"')).toBe(true);
  });

  it('strips what a header may not carry, keeping the real name in filename*', () => {
    const header = attachmentDisposition('Gehaltsabrechnung Mai\r\n.pdf');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''Gehaltsabrechnung%20Mai%0D%0A.pdf");
  });

  it('never emits an empty ascii filename', () => {
    expect(attachmentDisposition('日本語.pdf')).toContain('filename="___.pdf"');
  });
});
