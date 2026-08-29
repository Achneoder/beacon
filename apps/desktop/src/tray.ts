import { Menu, Tray, nativeImage } from 'electron';
import { t, type Language, type MessageKey } from './locales.js';
import type { Settings } from './settings.js';
import type { TrackerStatus } from './tracker.js';
import { assetPath } from './window.js';

export interface TrayActions {
  open: () => void;
  clockIn: () => void;
  clockOut: () => void;
  toggle: (key: 'autoTrack' | 'stopOnSuspend' | 'stopOnLock', value: boolean) => void;
  changeServer: () => void;
  quit: () => void;
}

/**
 * The status readout and the manual override.
 *
 * It is the desktop app's only permanent surface, and it exists because the feature is
 * invisible otherwise: something that clocks people in and out on its own has to say
 * plainly what it is doing, and let them stop it in one click.
 */
export class StatusTray {
  readonly #tray: Tray;

  constructor(
    private readonly actions: TrayActions,
    private status: TrackerStatus,
    private settings: Settings,
  ) {
    this.#tray = new Tray(icon(status));
    this.render();
  }

  update(status: TrackerStatus, settings: Settings): void {
    this.status = status;
    this.settings = settings;
    this.#tray.setImage(icon(status));
    this.render();
  }

  destroy(): void {
    this.#tray.destroy();
  }

  private render(): void {
    const { language } = this.settings;
    const label = (key: MessageKey) => t(language, key);
    const running = this.status.state !== 'out';

    this.#tray.setToolTip(`${label('tray.tooltip')} — ${stateLabel(language, this.status)}`);
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: stateLabel(language, this.status), enabled: false },
        { type: 'separator' },
        { label: label('tray.open'), click: this.actions.open },
        {
          label: running ? label('tray.clockOut') : label('tray.clockIn'),
          click: running ? this.actions.clockOut : this.actions.clockIn,
        },
        { type: 'separator' },
        {
          label: label('tray.autoTrack'),
          type: 'checkbox',
          checked: this.settings.autoTrack,
          click: (item) => this.actions.toggle('autoTrack', item.checked),
        },
        {
          label: label('tray.stopOnSuspend'),
          type: 'checkbox',
          checked: this.settings.stopOnSuspend,
          enabled: this.settings.autoTrack,
          click: (item) => this.actions.toggle('stopOnSuspend', item.checked),
        },
        {
          label: label('tray.stopOnLock'),
          type: 'checkbox',
          checked: this.settings.stopOnLock,
          enabled: this.settings.autoTrack,
          click: (item) => this.actions.toggle('stopOnLock', item.checked),
        },
        { type: 'separator' },
        { label: label('tray.changeServer'), click: this.actions.changeServer },
        { label: label('tray.quit'), click: this.actions.quit },
      ]),
    );
  }
}

/**
 * What the menu bar says. The connection comes first: "not tracking" when the truth is
 * "cannot tell" would be a lie about someone's timesheet.
 */
export function stateLabel(language: Language, status: TrackerStatus): string {
  if (status.connection === 'signedOut') return t(language, 'tray.state.signedOut');
  if (status.connection === 'offline' || status.connection === 'unknown') {
    return t(language, 'tray.state.offline');
  }

  return t(language, `tray.state.${status.state}` as MessageKey);
}

function icon(status: TrackerStatus) {
  const name =
    status.connection === 'offline' || status.connection === 'signedOut'
      ? 'tray-offline'
      : status.state === 'in'
        ? 'tray-in'
        : status.state === 'break'
          ? 'tray-break'
          : 'tray-out';

  return nativeImage.createFromPath(assetPath(`${name}.png`)).resize({ width: 16, height: 16 });
}
