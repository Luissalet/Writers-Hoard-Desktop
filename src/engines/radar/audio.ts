const KEY = 'wh.radar.notch-audio';
export const RADAR_AUDIO_CHANGED = 'wh:radar-audio-changed';
let preference: boolean | undefined;
export function radarAudioEnabled(): boolean { if (preference !== undefined) return preference; try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
export function setRadarAudioEnabled(enabled: boolean): void { preference = enabled; try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* The toggle still works for this mounted editor. */ } if (typeof window !== 'undefined') window.dispatchEvent(new Event(RADAR_AUDIO_CHANGED)); }
/** Local synthesized ticks only. Context ownership belongs to the mounted graphic. */
export function playRadarNotch(context: AudioContext, fraction: number): void {
  const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
  oscillator.type = 'sine'; oscillator.frequency.value = 240 + fraction * 480;
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.025, now + 0.004); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.05);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
