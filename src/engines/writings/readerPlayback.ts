export interface ReaderPlaybackOptions { mode: 'read' | 'play'; wordsPerMinute: number }
export interface ReaderPlaybackCopy { read: string; play: string; pause: string; previous: string; next: string; restart: string; progress: string }

/** The same DOM controller runs in the app and in the standalone, offline book.
 * It changes only visibility, never the manuscript or the hydrated tool blocks. */
export function installReaderPlayback(prose: HTMLElement, controls: HTMLElement, options: ReaderPlaybackOptions, copy: ReaderPlaybackCopy) {
  let blocks: HTMLElement[] = [], revealed = 1, mode = options.mode, playing = false, timer = 0, disposed = false;
  const originalHidden = new Map<HTMLElement, boolean>();
  const button = (action: string, label: string) => { const node = document.createElement('button'); node.type = 'button'; node.dataset.readerPlayback = action; node.textContent = label; controls.append(node); return node; };
  const read = button('read', copy.read), play = button('play', copy.play), previous = button('previous', copy.previous), next = button('next', copy.next), restart = button('restart', copy.restart);
  const status = document.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); controls.append(status);
  const clear = () => { window.clearTimeout(timer); timer = 0; };
  const paint = () => {
    blocks.forEach((block, index) => { block.hidden = originalHidden.get(block) || mode === 'play' && index >= revealed; block.toggleAttribute('data-reader-active-block', mode === 'play' && index === revealed - 1); });
    prose.dataset.readerPlaybackMode = mode;
    prose.toggleAttribute('data-reader-playback-incomplete', mode === 'play' && revealed < blocks.length);
    const words = blocks.map(block => block.textContent?.match(/\S+/g)?.length ?? 0), total = words.reduce((sum, count) => sum + count, 0);
    prose.dataset.readerRevealedFraction = String(total ? words.slice(0, revealed).reduce((sum, count) => sum + count, 0) / total : Math.min(1, revealed / Math.max(1, blocks.length)));
    read.setAttribute('aria-pressed', String(mode === 'read')); play.setAttribute('aria-pressed', String(mode === 'play'));
    play.textContent = playing ? copy.pause : copy.play;
    previous.disabled = mode !== 'play' || revealed <= 1; next.disabled = mode !== 'play' || revealed >= blocks.length; restart.disabled = mode !== 'play' || revealed <= 1 && !playing;
    previous.hidden = next.hidden = restart.hidden = mode === 'read';
    status.textContent = mode === 'play' && blocks.length ? copy.progress.replace('{current}', String(revealed)).replace('{total}', String(blocks.length)) : '';
  };
  const announce = () => prose.dispatchEvent(new CustomEvent('wh-reader-reveal', { bubbles: true }));
  const schedule = () => {
    clear(); if (!playing || disposed || document.hidden || !blocks.length) return;
    const text = blocks[revealed - 1]?.textContent?.trim() ?? '';
    const count = text.match(/\S+/g)?.length ?? 0;
    const delay = Math.max(1500, count * 60000 / Math.max(60, options.wordsPerMinute));
    timer = window.setTimeout(() => {
      if (!prose.getClientRects().length) { playing = false; paint(); return; }
      if (revealed >= blocks.length) { playing = false; paint(); return; }
      revealed++; paint(); blocks[revealed - 1]?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); announce(); schedule();
    }, delay);
  };
  const refresh = () => {
    const latest = Array.from(prose.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
    if (latest.length === blocks.length && latest.every((node, index) => node === blocks[index])) return;
    blocks = latest;
    blocks.forEach(block => { if (!originalHidden.has(block)) originalHidden.set(block, block.hidden); });
    revealed = Math.max(1, Math.min(revealed, blocks.length)); paint(); schedule();
  };
  const click = (event: Event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-reader-playback]'); if (!target || !controls.contains(target)) return;
    clear();
    switch (target.dataset.readerPlayback) {
      case 'read': mode = 'read'; playing = false; break;
      case 'play':
        if (mode === 'read') { mode = 'play'; revealed = 1; }
        else if (!playing && revealed >= blocks.length) revealed = 1;
        playing = !playing;
        if (playing) prose.dispatchEvent(new CustomEvent('wh-reader-play', { bubbles: true }));
        break;
      case 'previous': playing = false; revealed = Math.max(1, revealed - 1); break;
      case 'next': playing = false; revealed = Math.min(blocks.length, revealed + 1); break;
      case 'restart': playing = false; revealed = 1; break;
    }
    paint(); announce(); schedule();
  };
  const visibility = () => { if (document.hidden) clear(); else schedule(); };
  const otherPlay = (event: Event) => { if (event.target !== prose && playing) { playing = false; clear(); paint(); } };
  const observer = new MutationObserver(refresh); observer.observe(prose, { childList: true });
  controls.addEventListener('click', click); document.addEventListener('visibilitychange', visibility); document.addEventListener('wh-reader-play', otherPlay);
  refresh();
  return () => {
    disposed = true; clear(); observer.disconnect(); controls.removeEventListener('click', click); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('wh-reader-play', otherPlay);
    for (const [block, hidden] of originalHidden) { block.hidden = hidden; block.removeAttribute('data-reader-active-block'); }
    delete prose.dataset.readerPlaybackMode; delete prose.dataset.readerRevealedFraction; prose.removeAttribute('data-reader-playback-incomplete'); controls.replaceChildren();
  };
}

export const readerPlaybackCopy = (locale: 'es' | 'en'): ReaderPlaybackCopy => locale === 'es'
  ? { read: 'Leer', play: 'Reproducir', pause: 'Pausar', previous: 'Bloque anterior', next: 'Siguiente bloque', restart: 'Reiniciar', progress: '{current} de {total} bloques' }
  : { read: 'Read', play: 'Play', pause: 'Pause', previous: 'Previous block', next: 'Next block', restart: 'Restart', progress: '{current} of {total} blocks' };
