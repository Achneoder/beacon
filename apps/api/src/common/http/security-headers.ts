import type { NextFunction, Request, Response } from 'express';

/**
 * The response headers every API reply carries.
 *
 * Hand-written rather than Helmet: Helmet's defaults are tuned for an app that serves
 * HTML, and several of them (its CSP, COEP, CORP) either do nothing here or get in the
 * way of a browser SPA on another origin calling this API. Beacon's API serves JSON, a
 * CSV export and two redirects — nothing a browser renders — so the useful set is small
 * enough to state outright and explain.
 *
 * `Cache-Control: no-store` is the one that matters most, and it is a privacy control
 * rather than a security header. Nothing set it before, so a payslip listing, a people
 * record or an absence reason was heuristically cacheable — by an intermediary, and by
 * the browser's own disk cache. Beacon is deployed on-premise, often onto shared
 * workstations, which is exactly where a cached response outlives the session that
 * fetched it. Every response here is either personal data or a redirect, so there is
 * nothing that would benefit from an exception.
 */
export function securityHeaders(request: Request, response: Response, next: NextFunction): void {
  // Personal data, on a shared machine. Never cached, never stored.
  response.setHeader('Cache-Control', 'no-store');
  // A JSON body must never be sniffed into something a browser will execute.
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // Nothing here is meant to be framed, and the API sets no cookies a frame could ride.
  response.setHeader('X-Frame-Options', 'DENY');
  // The SSO callback carries `state` and `code` in its URL; a Referer must not leak
  // them onward to the IdP's own page or to anything the redirect target loads.
  response.setHeader('Referrer-Policy', 'no-referrer');
  // Belt and braces behind `nosniff`: if a response were ever rendered as a document,
  // it may load nothing at all.
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  // Only over TLS — announcing HSTS on a plain-http dev server would pin a developer's
  // browser to https for localhost and break every other local project on that port.
  if (request.secure) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
