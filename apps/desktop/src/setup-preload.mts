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
  retry: string | null;
  url: string | null;
}

export interface SetupResult {
  ok: boolean;
  message: string;
}

contextBridge.exposeInMainWorld('beaconSetup', {
  copy: (): Promise<SetupCopy> => ipcRenderer.invoke('setup:copy'),
  submit: (url: string): Promise<SetupResult> => ipcRenderer.invoke('setup:submit', url),
  retry: (): Promise<void> => ipcRenderer.invoke('setup:retry'),
});
