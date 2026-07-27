import { useCallback, useEffect, useState } from 'react';
import Dexie from 'dexie';
import { Database, ShieldCheck } from 'lucide-react';
import { toast } from './toast';

interface StorageSnapshot {
  usage: number;
  quota: number;
  persisted: boolean;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function StorageStatus() {
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
  const percentage = snapshot.quota ? Math.round((snapshot.usage / snapshot.quota) * 100) : 0;
  const requestPersistence = async () => {
    if (!navigator.storage.persist) return;
    const persisted = await navigator.storage.persist();
    await refresh();
    if (persisted) toast.success('Persistent local storage enabled');
    else toast.info('The operating system kept the default storage policy');
  };
  return (
    <button
      type="button"
      onClick={() => void requestPersistence()}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-dim transition hover:bg-elevated hover:text-text-primary"
      title={`${formatBytes(snapshot.usage)} used of ${formatBytes(snapshot.quota)}. Click to request persistent storage.`}
    >
      {snapshot.persisted ? <ShieldCheck size={14} className="text-green-400" /> : <Database size={14} />}
      <span>{percentage}%</span>
    </button>
  );
}
