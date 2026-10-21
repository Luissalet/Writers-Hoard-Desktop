import { useEffect, useRef, type RefObject } from 'react';
import { installReaderPlayback, readerPlaybackCopy, type ReaderPlaybackOptions } from '../readerPlayback';

export default function ReaderPlaybackControl({ prose, options, locale, content }: { prose: RefObject<HTMLDivElement | null>; options: ReaderPlaybackOptions; locale: 'es' | 'en'; content: string }) {
  const controls = useRef<HTMLDivElement>(null);
  const { mode, wordsPerMinute } = options;
  useEffect(() => {
    if (prose.current && controls.current) return installReaderPlayback(prose.current, controls.current, { mode, wordsPerMinute }, readerPlaybackCopy(locale));
  }, [prose, mode, wordsPerMinute, locale, content]);
  return <div ref={controls} role="group" aria-label={locale === 'es' ? 'Lectura por bloques' : 'Block reading'} className="wh-reader-playback mx-auto my-4 flex flex-wrap items-center gap-2 text-sm" style={{ maxWidth: 'var(--wh-reading-measure)' }} />;
}
