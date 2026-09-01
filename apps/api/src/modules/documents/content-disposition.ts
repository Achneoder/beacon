/**
 * `Content-Disposition` for a stored document.
 *
 * The filename is the uploader's own text, so it is never interpolated as-is: a quote
 * would truncate the header and a control character would make Node reject the whole
 * response. Both forms are sent, as RFC 6266 prescribes — a stripped-down ASCII
 * `filename` for anything old, and `filename*` carrying the real, possibly non-Latin
 * name for everyone else.
 *
 * Always `attachment`. Beacon accepts pdf, docx and jpg, and a pdf rendered inline
 * would run on the API's own origin; the web app opens what it can from a `blob:` URL
 * instead, where nothing it does reaches a session.
 */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${fallback || 'document'}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
