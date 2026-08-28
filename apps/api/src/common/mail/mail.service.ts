/** One outbound message. `text` is required; `html` is the richer alternative part. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Every outbound email goes through this interface, so an organization can point
 * Beacon at its own relay — or run without one — without a feature knowing.
 * Inject `MailService`; never import `nodemailer` from feature code.
 *
 * Implementations must not throw for a message they could not deliver: an invitation
 * is created and stored whether or not the notification reaches the invitee, and the
 * accept link is handed back either way. `send` reports delivery, it does not gate it.
 */
export abstract class MailService {
  /** True when the message was handed to a transport, false when it was dropped. */
  abstract send(message: MailMessage): Promise<boolean>;
}
