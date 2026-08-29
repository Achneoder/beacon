/**
 * Native copy — the tray menu, the setup window, the notifications.
 *
 * `svelte-i18n` does not reach a macOS menu bar or a Windows tray, so the desktop
 * app carries its own copy the way the invitation email does
 * (`apps/api/src/modules/invitations/invitation-email.ts`): a pure function over the
 * same `en` / `de` pair the web locales use, no template engine, no runtime loader.
 * Everything the user reads inside the window comes from `apps/web` as usual.
 */

export const LANGUAGES = ['en', 'de'] as const;

export type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    'tray.tooltip': 'Beacon',
    'tray.state.in': 'Tracking',
    'tray.state.break': 'On a break',
    'tray.state.out': 'Not tracking',
    'tray.state.offline': 'Not connected',
    'tray.state.signedOut': 'Signed out',
    'tray.open': 'Open Beacon',
    'tray.clockIn': 'Clock in',
    'tray.clockOut': 'Clock out',
    'tray.autoTrack': 'Track automatically',
    'tray.stopOnSuspend': 'Stop when the computer sleeps',
    'tray.stopOnLock': 'Stop when the screen locks',
    'tray.changeServer': 'Change server…',
    'tray.quit': 'Quit Beacon',
    'setup.title': 'Connect to Beacon',
    'setup.intro': 'Enter the address of your organization’s Beacon server.',
    'setup.label': 'Server address',
    'setup.submit': 'Connect',
    'setup.invalid': 'That is not a valid address. It should look like https://beacon.example.com',
    'error.title': 'Cannot reach Beacon',
    'error.body': 'Beacon did not answer at {url}. Your time is still being recorded and will be sent when the connection returns.',
    'error.retry': 'Try again',
    'error.change': 'Change server',
  },
  de: {
    'tray.tooltip': 'Beacon',
    'tray.state.in': 'Zeiterfassung läuft',
    'tray.state.break': 'In der Pause',
    'tray.state.out': 'Keine Zeiterfassung',
    'tray.state.offline': 'Nicht verbunden',
    'tray.state.signedOut': 'Abgemeldet',
    'tray.open': 'Beacon öffnen',
    'tray.clockIn': 'Einstempeln',
    'tray.clockOut': 'Ausstempeln',
    'tray.autoTrack': 'Automatisch erfassen',
    'tray.stopOnSuspend': 'Beim Ruhezustand beenden',
    'tray.stopOnLock': 'Beim Sperren des Bildschirms beenden',
    'tray.changeServer': 'Server ändern…',
    'tray.quit': 'Beacon beenden',
    'setup.title': 'Mit Beacon verbinden',
    'setup.intro': 'Geben Sie die Adresse des Beacon-Servers Ihrer Organisation ein.',
    'setup.label': 'Serveradresse',
    'setup.submit': 'Verbinden',
    'setup.invalid': 'Das ist keine gültige Adresse. Sie sollte wie https://beacon.example.com aussehen.',
    'error.title': 'Beacon nicht erreichbar',
    'error.body': 'Beacon hat unter {url} nicht geantwortet. Ihre Zeit wird weiter aufgezeichnet und übertragen, sobald die Verbindung zurück ist.',
    'error.retry': 'Erneut versuchen',
    'error.change': 'Server ändern',
  },
} as const satisfies Record<Language, Record<string, string>>;

export type MessageKey = keyof (typeof COPY)['en'];

/**
 * The keys a language actually carries. Exported so the test can hold `en` and `de`
 * to the same set — a key added to one and forgotten in the other would ship as
 * English to a German user, which is the failure the fallback in {@link t} hides.
 */
export function messageKeys(language: Language): string[] {
  return Object.keys(COPY[language]).sort();
}

/**
 * Looks a message up, substituting `{name}` placeholders. An unknown language falls
 * back to English rather than showing the user a key.
 */
export function t(
  language: Language,
  key: MessageKey,
  values: Record<string, string> = {},
): string {
  const message: string = COPY[language]?.[key] ?? COPY.en[key];

  return message.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** Narrows whatever the OS reports — `de-AT`, `en-GB` — to a language we carry. */
export function toLanguage(locale: string | undefined | null): Language {
  const tag = (locale ?? '').slice(0, 2).toLowerCase();

  return (LANGUAGES as readonly string[]).includes(tag) ? (tag as Language) : 'en';
}
