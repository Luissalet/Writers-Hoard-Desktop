import type { AppUpdater } from 'electron-updater';
import type { DesktopUpdateState } from '../src/types/updates';

type Updater = Pick<AppUpdater,
  'on' | 'checkForUpdates' | 'downloadUpdate' | 'autoDownload' | 'autoInstallOnAppQuit' |
  'allowPrerelease' | 'allowDowngrade'>;

/** Owns one update transaction; listeners are installed before the first check. */
export function createUpdateController(
  updater: Updater,
  currentVersion: string,
  enabled: boolean,
  publish: (state: DesktopUpdateState) => void,
) {
  let state: DesktopUpdateState = { revision: 0, status: enabled ? 'idle' : 'disabled', currentVersion };
  let busy = false;
  const set = (next: Omit<DesktopUpdateState, 'revision' | 'currentVersion'>) => {
    state = { ...next, revision: state.revision + 1, currentVersion };
    publish({ ...state });
  };
  const fail = () => set({ status: 'error', version: state.version });

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = true;
  updater.allowDowngrade = false;
  updater.on('error', fail);
  updater.on('update-available', (info) => set({ status: 'available', version: info.version }));
  updater.on('update-not-available', () => set({ status: 'latest' }));
  updater.on('download-progress', (info) => set({
    status: 'downloading', version: state.version,
    percent: Math.max(0, Math.min(100, Number.isFinite(info.percent) ? info.percent : 0)),
  }));
  updater.on('update-downloaded', (info) => set({ status: 'downloaded', version: info.version, percent: 100 }));

  return {
    reportFailure: fail,
    snapshot: (): DesktopUpdateState => ({ ...state }),
    async check(): Promise<void> {
      if (!enabled || busy || state.status === 'downloading' || state.status === 'downloaded') return;
      busy = true;
      set({ status: 'checking' });
      try {
        await updater.checkForUpdates();
        if (state.status === 'checking') fail();
      } catch { fail(); }
      finally { busy = false; }
    },
    async download(): Promise<void> {
      if (!enabled || busy || state.status !== 'available') return;
      busy = true;
      set({ status: 'downloading', version: state.version, percent: 0 });
      try { await updater.downloadUpdate(); }
      catch { fail(); }
      finally { busy = false; }
    },
  };
}
