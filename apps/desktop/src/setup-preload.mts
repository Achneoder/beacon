import { contextBridge, ipcRenderer } from 'electron';

/**
 * The bridge for `assets/connect.html`, the one screen this app draws itself.
 *
 * `.mts` on purpose: Electron only loads an ES-module preload from a `.mjs` file, and
 * this workspace compiles as ESM. Three calls, no `ipcRenderer` handed to the page —
 * the served web app that loads afterwards gets no preload at all and no privilege
 * beyond what any browser tab has.
 */
export interface SetupCopy {
  language: string;
  title: string;
  intro: string;
  label: string;
  submit: string;
  checking: string;
  confirm: string;
  retry: string | null;
  url: string | null;
  /** True when the address is enforced and the field must not be editable. */
  locked: boolean;
}

export interface SetupResult {
  ok: boolean;
  message: string;
  /**
   * The address answered, but the instance still needs to be installed. Not an error:
   * the screen relabels its button and asks for one more click before adopting it, so
   * a person does not silently register themselves as the owner of the wrong company's
   * fresh install.
   */
  confirm?: boolean;
}

contextBridge.exposeInMainWorld('beaconSetup', {
  copy: (): Promise<SetupCopy> => ipcRenderer.invoke('setup:copy'),
  submit: (url: string, confirmed?: boolean): Promise<SetupResult> =>
    ipcRenderer.invoke('setup:submit', url, confirmed),
  retry: (): Promise<void> => ipcRenderer.invoke('setup:retry'),
});
