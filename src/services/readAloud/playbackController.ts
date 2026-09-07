import type {
  ReadAloudSegment,
  ReadAloudSnapshot,
  SpeechDriver,
} from './types';
import { voicePreferenceKey } from './adapters';

const MIN_RATE = 0.5;
const MAX_RATE = 2;

function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Number.isFinite(rate) ? rate : 1));
}

export interface ReadAloudControllerOptions {
  driver: SpeechDriver;
  segments?: readonly ReadAloudSegment[];
  locale?: 'es' | 'en';
  rate?: number;
  voicePreferences?: Readonly<Record<string, string | undefined>>;
}

/**
 * A small state machine around Web Speech. Only one segment is queued at a
 * time, which keeps pause/skip/jump deterministic and lets stale browser
 * callbacks be ignored after cancel.
 */
export class ReadAloudController {
  private readonly driver: SpeechDriver;
  private segments: readonly ReadAloudSegment[];
  private locale: 'es' | 'en';
  private voicePreferences: Readonly<Record<string, string | undefined>>;
  private listeners = new Set<() => void>();
  private completed = new Set<number>();
  private generation = 0;
  private destroyed = false;

  private snapshot: ReadAloudSnapshot;

  constructor(options: ReadAloudControllerOptions) {
    this.driver = options.driver;
    this.segments = options.segments ?? [];
    this.locale = options.locale ?? 'es';
    this.voicePreferences = options.voicePreferences ?? {};
    this.snapshot = {
      status: this.driver.supported ? 'idle' : 'unsupported',
      activeIndex: this.segments.length > 0 ? 0 : -1,
      completedIndexes: [],
      activeCharIndex: 0,
      rate: clampRate(options.rate ?? 1),
      supported: this.driver.supported,
      boundaryEvents: this.driver.boundaryEvents,
    };
  }

  getSnapshot = (): ReadAloudSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(changes: Partial<ReadAloudSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...changes,
      completedIndexes: [...this.completed].sort((left, right) => left - right),
    };
    for (const listener of this.listeners) listener();
  }

  setSegments(segments: readonly ReadAloudSegment[]): void {
    this.stopInternal(false);
    this.segments = segments;
    this.completed.clear();
    this.publish({
      status: this.driver.supported ? 'idle' : 'unsupported',
      activeIndex: segments.length > 0 ? 0 : -1,
      activeCharIndex: 0,
      error: undefined,
    });
  }

  setLocale(locale: 'es' | 'en'): void {
    this.locale = locale;
  }

  setVoicePreferences(preferences: Readonly<Record<string, string | undefined>>): void {
    this.voicePreferences = preferences;
  }

  setRate(rate: number): void {
    this.publish({ rate: clampRate(rate) });
  }

  play(index?: number): void {
    if (!this.driver.supported || this.destroyed || this.segments.length === 0) return;
    const target = index ?? (this.snapshot.status === 'finished'
      ? 0
      : this.snapshot.activeIndex < 0 ? 0 : this.snapshot.activeIndex);
    if (this.snapshot.status === 'finished') this.completed.clear();
    this.startAt(target);
  }

  pause(): void {
    if (this.snapshot.status !== 'playing') return;
    this.driver.pause();
    this.publish({ status: 'paused' });
  }

  resume(): void {
    if (this.snapshot.status !== 'paused') return;
    this.driver.resume();
    this.publish({ status: 'playing' });
  }

  toggle(): void {
    if (this.snapshot.status === 'playing') this.pause();
    else if (this.snapshot.status === 'paused') this.resume();
    else this.play();
  }

  stop(): void {
    this.stopInternal(true);
  }

  private stopInternal(publish: boolean): void {
    this.generation += 1;
    this.driver.cancel();
    if (publish) {
      this.publish({
        status: this.driver.supported ? 'idle' : 'unsupported',
        activeCharIndex: 0,
        error: undefined,
      });
    }
  }

  skip(delta = 1): void {
    if (this.segments.length === 0) return;
    const origin = this.snapshot.activeIndex < 0 ? 0 : this.snapshot.activeIndex;
    this.jumpTo(origin + delta);
  }

  jumpTo(index: number): void {
    if (this.segments.length === 0) return;
    const target = Math.min(this.segments.length - 1, Math.max(0, index));
    const wasActive = this.snapshot.status === 'playing' || this.snapshot.status === 'paused';
    this.generation += 1;
    this.driver.cancel();
    this.publish({
      activeIndex: target,
      activeCharIndex: 0,
      status: wasActive && this.driver.supported ? 'playing' : this.snapshot.status,
      error: undefined,
    });
    if (wasActive && this.driver.supported) this.startAt(target, false);
  }

  private startAt(index: number, cancelFirst = true): void {
    const target = Math.min(this.segments.length - 1, Math.max(0, index));
    if (cancelFirst) {
      this.generation += 1;
      this.driver.cancel();
    }
    const token = ++this.generation;
    const segment = this.segments[target];
    if (!segment) return;
    const preferenceKey = voicePreferenceKey(segment);
    this.publish({
      status: 'playing',
      activeIndex: target,
      activeCharIndex: 0,
      error: undefined,
    });

    this.driver.speak({
      text: segment.text,
      lang: this.locale === 'es' ? 'es-ES' : 'en-US',
      rate: this.snapshot.rate,
      voiceURI: preferenceKey ? this.voicePreferences[preferenceKey] : undefined,
      onStart: () => {
        if (token !== this.generation || this.destroyed) return;
        this.publish({ status: 'playing' });
      },
      onBoundary: ({ charIndex }) => {
        if (token !== this.generation || this.destroyed) return;
        this.publish({ activeCharIndex: Math.max(0, charIndex) });
      },
      onEnd: () => {
        if (token !== this.generation || this.destroyed) return;
        this.completed.add(target);
        if (target >= this.segments.length - 1) {
          this.publish({
            status: 'finished',
            activeIndex: target,
            activeCharIndex: segment.text.length,
          });
          return;
        }
        this.startAt(target + 1, false);
      },
      onError: (error) => {
        if (token !== this.generation || this.destroyed) return;
        this.publish({ status: 'error', error, activeCharIndex: 0 });
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopInternal(false);
    this.listeners.clear();
  }
}
