import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesktopUpdateState } from '@/types/updates';

export default function DesktopUpdates() {
  const { t } = useTranslation();
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.updates;
    if (!api) return;
    let active = true;
    const receive = (next: DesktopUpdateState) => {
      if (active) setState(previous => !previous || next.revision >= previous.revision ? next : previous);
    };
    // Subscribe first; a delayed snapshot cannot overwrite a newer push.
    const unsubscribe = api.onState(receive);
    const closeOpenListener = api.onOpen(() => setOpen(true));
    void api.getState().then(receive).catch(() => { if (active) setFailed(true); });
    return () => { active = false; unsubscribe(); closeOpenListener(); };
  }, []);

  const act = async (action: () => Promise<void>) => {
    setFailed(false);
    try { await action(); } catch { setFailed(true); }
  };
  const api = window.electronAPI?.updates;
  if (!api) return null;
  const status = state?.status ?? 'idle';
  const attention = status === 'available' || status === 'downloaded';
  const label = t(status === 'available' ? 'updates.available' : status === 'downloaded' ? 'updates.ready' : 'updates.title');
  const button = 'rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <>
      <button
        type="button"
        className={`desktop-updates-button ml-auto flex items-center gap-2 rounded px-2 py-1 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold ${attention ? 'text-accent-gold' : 'text-text-muted'}`}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
      >
        <Download size={14} aria-hidden="true" />
        <span role="status">{label}{status === 'downloading' ? ` ${Math.floor(state?.percent ?? 0)}%` : ''}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('updates.title')}>
        <div className="space-y-5">
          <p className="text-sm text-text-muted">{t('updates.current')} {state?.currentVersion ?? '—'}</p>
          <div role="status" aria-live="polite" className="space-y-3">
            <p className="text-text-primary">{t(`updates.status.${status}`)}{state?.version ? ` (${state.version})` : ''}</p>
            {status === 'downloading' && (
              <progress className="w-full accent-accent-gold" max={100} value={state?.percent ?? 0} aria-label={t('updates.downloading')} />
            )}
          </div>
          {(failed || status === 'error') && <p role="alert" className="text-sm text-text-muted">{t('updates.failureHelp')}</p>}
          {status === 'downloaded' && <p className="text-sm text-text-muted">{t('updates.installHint')}</p>}
          <div className="flex flex-wrap gap-3">
            {status === 'available' && <button className={button} onClick={() => void act(api.download)}>{t('updates.download')}</button>}
            {status === 'downloaded' && <button className={button} onClick={() => { setOpen(false); void act(api.quitAndInstall); }}>{t('updates.install')}</button>}
            <button className={button} disabled={['checking', 'downloading', 'downloaded', 'disabled'].includes(status)} onClick={() => void act(api.check)}>{t('updates.check')}</button>
            <button className={button} onClick={() => void act(api.openReleases)}>{t('updates.github')}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
