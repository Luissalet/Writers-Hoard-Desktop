import { useCallback, useEffect, useState } from 'react';
import Dexie from 'dexie';
import { Database, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { getSetting, setSetting } from '@/db/operations';
import { ensurePersistentStorage } from '@/services/appInitialization';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from './toast';

interface StorageSnapshot {
  usage: number;
  quota: number;
  persisted: boolean;
}

/** Stamped when the writer dismisses the eviction warning, so it stays gone. */
const WARNING_DISMISSED_KEY = 'storage.evictionWarningDismissedAt';

/**
 * Below this share of the quota the percentage is noise — every healthy library
 * is a rounding error against a browser's tens of gigabytes — so the chip shows
 * the size instead. At or above it the share is the number that matters, and it
 * is shown in the warning colour.
 */
const STORAGE_CROWDED_PERCENT = 60;

// The chip and the warning line are two views of one fact. When the chip wins
// persistence, the warning has to go — without waiting for a remount.
type PersistenceListener = (persisted: boolean) => void;
const persistenceListeners = new Set<PersistenceListener>();

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function StorageStatus() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  const refresh = useCallback(async () => {
    if (!navigator.storage?.estimate) return;
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? false,
    ]);
    setSnapshot({
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      persisted,
    });
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const onMutation = () => void refresh();
    Dexie.on('storagemutated', onMutation);
    return () => {
      window.clearTimeout(initialRefresh);
      Dexie.on('storagemutated').unsubscribe(onMutation);
    };
  }, [refresh]);

  if (!snapshot) return null;

  // What the chip SAYS is the size of the library, not its share of the quota.
  //
  // A browser hands out tens of gigabytes, so a real writing library — fifty
  // megabytes with every cover image in it — is 0 % of it. The chip read "0 %"
  // for every writer who ever opened the app, which is both useless and
  // alarming: it looks like a progress bar that never moved. The share is worth
  // showing only once it is large enough to mean something, and by then it is
  // the number that matters.
  const share = snapshot.quota > 0 ? (snapshot.usage / snapshot.quota) * 100 : 0;
  const crowded = share >= STORAGE_CROWDED_PERCENT;
  const label = crowded ? `${Math.round(share)}%` : formatBytes(snapshot.usage);

  const requestPersistence = async () => {
    if (!navigator.storage.persist) return;
    const persisted = await navigator.storage.persist();
    await refresh();
    for (const listener of persistenceListeners) listener(persisted);
    if (persisted) toast.success(t('storage.persistEnabled'));
    else toast.info(t('storage.persistDenied'));
  };
  // One sentence that says all three things the icon and the number cannot: how
  // much is stored, whether the browser has promised to keep it, and what
  // pressing this does. It is the tooltip AND the accessible name, because a
  // button reading "0 %" announces nothing at all.
  const description = `${t(
    snapshot.persisted ? 'storage.protected' : 'storage.evictable',
  )} ${t('storage.usageTooltip')
    .replace('{used}', formatBytes(snapshot.usage))
    .replace('{quota}', formatBytes(snapshot.quota))}`;

  return (
    <button
      type="button"
      onClick={() => void requestPersistence()}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition hover:bg-elevated hover:text-text-primary ${
        crowded ? 'text-warning' : 'text-text-dim'
      }`}
      title={description}
      aria-label={description}
    >
      {snapshot.persisted ? (
        <ShieldCheck size={14} className="text-green-400" aria-hidden="true" />
      ) : (
        <Database size={14} aria-hidden="true" />
      )}
      <span aria-hidden="true">{label}</span>
    </button>
  );
}

/**
 * The sentence the 14px chip was never going to say.
 *
 * An origin the browser has not marked persistent is evictable: the whole
 * library can be dropped under storage pressure, without a prompt and without a
 * trace. Startup already asked for persistence (`ensurePersistentStorage`); if
 * the answer was no, the writer deserves to be told in words, on the page they
 * land on, next to the button that makes a copy they own.
 *
 * Dismissible, and the dismissal is persisted — this warns once, it does not
 * nag forever.
 */
export function StoragePersistenceWarning() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const persisted = await ensurePersistentStorage();
      if (persisted || !alive) return;
      let dismissed: string | undefined;
      try {
        dismissed = await getSetting(WARNING_DISMISSED_KEY);
      } catch (error) {
        console.error('[storage] could not read the warning dismissal', error);
      }
      if (alive && !dismissed) setVisible(true);
    })();

    const onPersistence = (persisted: boolean) => {
      if (persisted) setVisible(false);
    };
    persistenceListeners.add(onPersistence);
    return () => {
      alive = false;
      persistenceListeners.delete(onPersistence);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    void setSetting(WARNING_DISMISSED_KEY, String(Date.now())).catch(error =>
      console.error('[storage] could not save the warning dismissal', error),
    );
  };

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
    >
      <ShieldAlert size={16} className="mt-0.5 flex-shrink-0 text-warning" />
      <p className="flex-1 text-sm leading-relaxed text-text-primary">
        {t('storage.evictionWarning')}
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="flex-shrink-0 text-text-dim transition hover:text-text-primary"
        aria-label={t('common.dismiss')}
        title={t('common.dismiss')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
