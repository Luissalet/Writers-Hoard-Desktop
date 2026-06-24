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
    let startTime = 0;
    let finished = false;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach((t) => t.stop());
      signal?.removeEventListener('abort', onAbort);
    };

    function onAbort() {
      if (finished) return;
      finished = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* noop */
      }
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort);

    recorder.onstop = () => {
      if (signal?.aborted) return; // already rejected by onAbort
      cleanup();
      resolve({
        blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
        mimeType: mimeType || 'video/webm',
        durationSec: totalSec,
      });
    };
    recorder.onerror = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('Recording failed.'));
    };

    const tick = () => {
      if (finished) return;
      const now = performance.now();
      if (!startTime) startTime = now;
      const elapsed = (now - startTime) / 1000;
      const scrollY = Math.min(elapsed * pps, maxScroll);
      drawFrame(scrollY);
      onProgress?.(Math.min(elapsed, totalSec), totalSec);
      if (elapsed >= totalSec) {
        finished = true;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          /* noop */
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    recorder.start();
    rafId = requestAnimationFrame(tick);
  });
}
