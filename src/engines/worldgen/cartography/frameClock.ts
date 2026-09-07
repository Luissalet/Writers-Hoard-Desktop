/** Coalesce invalidations without continually postponing the booked frame. */
export class CanvasFrameQueue {
  private frame = 0;
  private draw: () => void;
  private book: typeof requestAnimationFrame;
  private unbook: typeof cancelAnimationFrame;

  constructor(
    draw: () => void,
    book: typeof requestAnimationFrame = (callback) => requestAnimationFrame(callback),
    unbook: typeof cancelAnimationFrame = (id) => cancelAnimationFrame(id),
  ) {
    this.draw = draw;
    this.book = book;
    this.unbook = unbook;
  }

  request(): void {
    if (this.frame) return;
    this.frame = this.book(() => {
      this.frame = 0;
      this.draw();
    });
  }

  cancel(): void {
    if (this.frame) this.unbook(this.frame);
    this.frame = 0;
  }
}

/** Camera flights measure elapsed time, independent of GPU frame rate. */
export function flightProgress(startedAt: number, now: number, duration: number): number {
  return Math.min(1, Math.max(0, (now - startedAt) / duration));
}
