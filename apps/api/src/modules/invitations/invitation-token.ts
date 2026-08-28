import { createHash, randomBytes } from 'node:crypto';

/** How long an invitation stays acceptable. Long enough to survive a holiday. */
export const INVITATION_TTL_DAYS = 14;

/**
 * Invitation tokens follow the refresh-token rules: opaque, high-entropy, and stored
 * only as a digest — a database read must not hand anyone a working credential.
 */
export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationExpiry(from: Date = new Date(), days = INVITATION_TTL_DAYS): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Acceptable means: never accepted, and not yet expired. */
export function isAcceptable(
  invitation: { acceptedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return invitation.acceptedAt === null && invitation.expiresAt.getTime() > now.getTime();
}

/**
 * Where the invitee finishes signing up. The web app owns the route, so the base URL
 * is configuration — an emailed link has to point at the browser, not at the API.
 */
export function acceptUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/invite/${token}`;
}
