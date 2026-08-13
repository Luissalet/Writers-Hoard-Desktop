// ============================================================================
// Teleprompter video recorder (renderer)
// ============================================================================
//
// Renders the segments to an offscreen canvas the way TeleprompterView shows
// them (white serif text on black, scrolling at 50 * speed px/s) and captures
// the canvas to a WebM blob via MediaRecorder — the only container Chromium's
// MediaRecorder reliably produces. The caller transcodes the WebM to MP4 on
// desktop (ffmpeg, via IPC) or downloads the WebM directly on the web build.

export interface RecorderSegment {
  title: string;
  speakerName?: string;
  script: string;
}

export interface RecordOptions {
  segments: RecorderSegment[];
  width: number;
  height: number;
  /** Scroll-speed multiplier; on-screen px/s = 50 * speed (matches TeleprompterView). */
  speed: number;
  fps?: number;
  onProgress?: (elapsedSec: number, totalSec: number) => void;
  signal?: AbortSignal;
}

export interface RecordResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

interface Line {
  text: string;
  font: string;
  color: string;
  size: number;
  /** Extra vertical spacing added after this line. */
  gapAfter: number;
}

const FONT_FAMILY = 'Georgia, "Times New Roman", serif';

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

/** Word-wrap `text` to `maxWidth`, honoring explicit newlines. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function recordTeleprompter(opts: RecordOptions): Promise<RecordResult> {
  const { segments, width, height, speed, fps = 30, onProgress, signal } = opts;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  // Type scale relative to height (1080p reference).
  const scriptSize = Math.round(height * 0.062);
  const titleSize = Math.round(height * 0.03);
  const speakerSize = Math.round(height * 0.024);
  const maxWidth = width * 0.8;
  const lineHeight = 1.32;

  // Build the vertical "filmstrip" of lines.
  const lines: Line[] = [];
  segments.forEach((seg, i) => {
    if (seg.title) {
      lines.push({
        text: seg.title.toUpperCase(),
        font: `${titleSize}px ${FONT_FAMILY}`,
        color: 'rgba(255,255,255,0.42)',
        size: titleSize,
        gapAfter: seg.speakerName ? speakerSize * 0.4 : scriptSize * 0.5,
      });
    }
    if (seg.speakerName) {
      lines.push({
        text: seg.speakerName,
        font: `${speakerSize}px ${FONT_FAMILY}`,
        color: 'rgba(255,255,255,0.3)',
        size: speakerSize,
        gapAfter: scriptSize * 0.5,
      });
    }
    ctx.font = `${scriptSize}px ${FONT_FAMILY}`;
    const scriptLines = seg.script ? wrapText(ctx, seg.script, maxWidth) : [];
    scriptLines.forEach((sl) => {
      lines.push({
        text: sl,
        font: `${scriptSize}px ${FONT_FAMILY}`,
        color: '#ffffff',
        size: scriptSize,
        gapAfter: 0,
      });
    });
    if (i < segments.length - 1) {
      // blank spacer between segments
      lines.push({
        text: '',
        font: `${scriptSize}px ${FONT_FAMILY}`,
        color: '#ffffff',
        size: scriptSize,
        gapAfter: scriptSize * 1.6,
      });
    }
  });

  // Pre-compute y offsets and total content height.
  const positions: number[] = [];
  let cursor = 0;
  for (const ln of lines) {
    positions.push(cursor);
    cursor += ln.size * lineHeight + ln.gapAfter;
  }
  const contentHeight = cursor;

  const topPad = height * 0.6;
  const bottomPad = height * 0.6;
  const fullHeight = topPad + contentHeight + bottomPad;
  // Scale px/s with resolution so the perceived speed (and duration) is the
  // same at 720p or 1080p.
  const pps = 50 * speed * (height / 1080);
  const maxScroll = Math.max(0, fullHeight - height);
  const minDuration = 3;
  const totalSec = Math.max(minDuration, pps > 0 ? maxScroll / pps : 0);

  const drawFrame = (scrollY: number) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cx = width / 2;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.text) continue;
      const drawY = topPad + positions[i] - scrollY;
      if (drawY > height || drawY + ln.size < 0) continue;
      ctx.font = ln.font;
      ctx.fillStyle = ln.color;
      ctx.fillText(ln.text, cx, drawY);
    }
    // Top & bottom fades for a polished teleprompter look.
    const fade = height * 0.12;
    const topGrad = ctx.createLinearGradient(0, 0, 0, fade);
    topGrad.addColorStop(0, 'rgba(0,0,0,1)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, fade);
    const botGrad = ctx.createLinearGradient(0, height - fade, 0, height);
    botGrad.addColorStop(0, 'rgba(0,0,0,0)');
    botGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, height - fade, width, fade);
  };

  drawFrame(0);

  const mimeType = pickMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return await new Promise<RecordResult>((resolve, reject) => {
    let rafId = 0;
    let tickerId: ReturnType<typeof setInterval> | null = null;
    let watchdogId: ReturnType<typeof setTimeout> | null = null;
    let startTime = 0;
    /** The run has asked the recorder to stop; we are waiting for `onstop`. */
    let stopping = false;
    /** Terminated for good — the promise has settled exactly once. */
    let settled = false;
    let aborted = false;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      if (tickerId !== null) clearInterval(tickerId);
      if (watchdogId !== null) clearTimeout(watchdogId);
      tickerId = null;
      watchdogId = null;
      stream.getTracks().forEach((t) => t.stop());
      signal?.removeEventListener('abort', onAbort);
    };

    // Every exit goes through exactly one of these two. The old code had two
    // independent guards — `finished` on the abort path and `signal.aborted` on
    // the stop path — and cancelling in the window between "the run asked the
    // recorder to stop" and "onstop fired" tripped BOTH: the promise never
    // settled, the canvas stream stayed live, and the export modal was stuck in
    // `phase='recording'` with its close button hidden behind `busy`. Unclosable.
    const finish = (result: RecordResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const requestStop = () => {
      if (stopping) return;
      stopping = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else settleFromChunks();
      } catch {
        settleFromChunks();
      }
    };

    function settleFromChunks() {
      if (aborted) fail(new DOMException('Aborted', 'AbortError'));
      else
        finish({
          blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
          mimeType: mimeType || 'video/webm',
          durationSec: totalSec,
        });
    }

    function onAbort() {
      if (settled) return;
      aborted = true;
      requestStop();
      // Safety net: if `onstop` never arrives (recorder wedged, tracks already
      // dead), settle anyway rather than leaving the caller hanging forever.
      watchdogId = setTimeout(() => fail(new DOMException('Aborted', 'AbortError')), 1500);
    }
    signal?.addEventListener('abort', onAbort);

    recorder.onstop = () => settleFromChunks();
    recorder.onerror = () => fail(new Error('Recording failed.'));

    // Progress is derived from the wall clock, never accumulated per frame, and
    // it is driven by BOTH rAF (smooth while visible) and a plain interval.
    // rAF alone froze the scroll the moment the window was hidden or minimised
    // while MediaRecorder happily kept writing, so the exported video contained
    // a still frame lasting exactly as long as the user had looked away.
    const step = () => {
      if (settled || stopping) return;
      const now = performance.now();
      if (!startTime) startTime = now;
      const elapsed = (now - startTime) / 1000;
      drawFrame(Math.min(elapsed * pps, maxScroll));
      onProgress?.(Math.min(elapsed, totalSec), totalSec);
      if (elapsed >= totalSec) requestStop();
    };

    const paint = () => {
      if (settled || stopping) return;
      step();
      rafId = requestAnimationFrame(paint);
    };

    recorder.start();
    rafId = requestAnimationFrame(paint);
    tickerId = setInterval(step, 100);
  });
}
