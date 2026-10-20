import { useEffect, useRef, useState } from 'react';
import type { LocalMediaAsset } from './types';
export function LocalMediaPlayer({ asset, loop, speed, fallback, onEnded }: { asset: Pick<LocalMediaAsset, 'blob' | 'kind'>; loop: boolean; speed: number; fallback: string; onEnded?: () => void }) {
  const player = useRef<HTMLMediaElement | null>(null);
  // Bytes are immutable for this keyed asset. Metadata edits should not restart playback.
  const source = useRef(asset.blob);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(source.current); const media = player.current;
    if (media) { media.src = url; media.load(); }
    return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load(); } URL.revokeObjectURL(url); };
  }, []);
  useEffect(() => { if (player.current) player.current.playbackRate = speed; }, [speed]);
  return <div className="space-y-3">
    {asset.kind === 'video' ? <video ref={node => { player.current = node; }} controls loop={loop} preload="metadata" className="max-h-[28rem] w-full rounded-lg bg-black" onError={() => setFailed(true)} onEnded={onEnded} /> : <audio ref={node => { player.current = node; }} controls loop={loop} preload="metadata" className="w-full" onError={() => setFailed(true)} onEnded={onEnded} />}
    {failed && <p role="status" className="text-sm text-text-muted">{fallback}</p>}
  </div>;
}

