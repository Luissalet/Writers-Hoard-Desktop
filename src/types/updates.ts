export interface DesktopUpdateState {
  revision: number;
  status: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error' | 'disabled';
  currentVersion: string;
  version?: string;
  percent?: number;
}
