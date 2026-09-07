import type { ReadAloudVoice, SpeechDriver, SpeechRequest } from './types';

export interface BrowserSpeechHost {
  speechSynthesis?: SpeechSynthesis;
  utteranceCtor?: typeof SpeechSynthesisUtterance;
}

function currentSpeechHost(): BrowserSpeechHost | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return {
    speechSynthesis: globalThis.speechSynthesis,
    utteranceCtor: globalThis.SpeechSynthesisUtterance,
  };
}

/** Thin, capability-honest adapter over the browser/system Web Speech API. */
export class BrowserSpeechDriver implements SpeechDriver {
  private readonly speech?: SpeechSynthesis;
  private readonly Utterance?: typeof SpeechSynthesisUtterance;

  readonly supported: boolean;
  readonly boundaryEvents: boolean;

  constructor(host: BrowserSpeechHost | undefined = currentSpeechHost()) {
    this.speech = host?.speechSynthesis;
    this.Utterance = host?.utteranceCtor;
    this.supported = Boolean(this.speech && this.Utterance);
    if (!this.Utterance) {
      this.boundaryEvents = false;
    } else {
      const probe = new this.Utterance('');
      this.boundaryEvents = 'onboundary' in probe;
    }
  }

  speak(request: SpeechRequest): void {
    if (!this.speech || !this.Utterance) return;
    const utterance = new this.Utterance(request.text);
    utterance.lang = request.lang;
    utterance.rate = request.rate;
    const voice = this.speech.getVoices().find((candidate) => candidate.voiceURI === request.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.onstart = request.onStart;
    utterance.onboundary = (event) => request.onBoundary({
      charIndex: event.charIndex,
      charLength: event.charLength || 0,
    });
    utterance.onend = request.onEnd;
    utterance.onerror = (event) => request.onError(event.error || 'speech-error');
    this.speech.speak(utterance);
  }

  cancel(): void {
    this.speech?.cancel();
  }

  pause(): void {
    this.speech?.pause();
  }

  resume(): void {
    this.speech?.resume();
  }

  getVoices(): ReadAloudVoice[] {
    return (this.speech?.getVoices() ?? []).map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      default: voice.default,
    }));
  }

  subscribeVoices(listener: () => void): () => void {
    if (!this.speech) return () => undefined;
    this.speech.addEventListener('voiceschanged', listener);
    return () => this.speech?.removeEventListener('voiceschanged', listener);
  }
}
