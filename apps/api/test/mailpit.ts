/**
 * Reads the throwaway Mailpit from `infra/docker-compose.e2e.yml` back out over its REST
 * API. This is the only way either e2e suite can prove a message actually left the API —
 * a mocked `MailService` would prove the call, not the SMTP conversation.
 *
 * The port is pinned here rather than read from `.env`: like the database, a suite that
 * invites people must never reach a relay that would deliver to a real address.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:58025';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Every message Mailpit currently holds, newest first. */
async function messages(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`mailpit responded ${response.status}`);

  return ((await response.json()) as { messages: MailpitMessage[] }).messages;
}

/**
 * SMTP delivery finishes after the HTTP response the test is awaiting, so the message
 * is polled for rather than assumed to have landed.
 */
export async function waitForMail(
  to: string,
  timeoutMs = 5000,
): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const match = (await messages()).find((message) =>
      message.To.some((recipient) => recipient.Address.toLowerCase() === to.toLowerCase()),
    );

    if (match) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const body = (await response.json()) as { Subject: string; Text: string; HTML: string };

      return { subject: body.Subject, text: body.Text, html: body.HTML };
    }

    if (Date.now() > deadline) throw new Error(`no mail for ${to} within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Wipes the mailbox, so one spec's messages are never mistaken for another's. */
export async function clearMail(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
