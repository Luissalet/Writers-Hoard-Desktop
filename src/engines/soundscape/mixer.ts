// The soundscape's player: one AudioContext, a master gain, a gain per strip;
// loops of the live scene play together, one-shots fire on demand; changing
// the live scene crossfades. Nothing starts without the listener's click
// (the browser's autoplay rule), and stopping releases everything.
import { db } from '@/db';
import type { SoundScene, Soundscape } from './model';

type Playing = { source: AudioBufferSourceNode; gain: GainNode; stripId: string };

/** Decoded sound is large (4 bytes per sample per channel); keep about this much of it and let the least recently used go. */
export const DECODED_BYTES_LIMIT = 200 * 1024 * 1024;
const decodedBytes = (buffer: AudioBuffer) => (buffer.length || 0) * (buffer.numberOfChannels || 1) * 4;

export class SoundscapeMixer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  // Insertion order is recency order: a hit moves the entry to the end, eviction takes from the front.
  private buffers = new Map<string, AudioBuffer>();
  private cachedBytes = 0;
  private playing: Playing[] = [];
  /** Each listen() and stop() takes a new number; a call that finds it has moved on gives up. */
  private generation = 0;
  listening = false;

  private remember(assetId: string, buffer: AudioBuffer) {
    const bytes = decodedBytes(buffer);
    if (bytes > DECODED_BYTES_LIMIT) return;
    this.buffers.set(assetId, buffer); this.cachedBytes += bytes;
    for (const [id, old] of this.buffers) {
      if (this.cachedBytes <= DECODED_BYTES_LIMIT) break;
      if (id === assetId) continue;
      this.buffers.delete(id); this.cachedBytes -= decodedBytes(old);
    }
  }
  /** Decoded sounds kept for replay (for tests and for the panel's memory). */
  get cachedSounds() { return this.buffers.size; }

  private async buffer(assetId: string): Promise<AudioBuffer | null> {
    const kept = this.buffers.get(assetId);
    if (kept) { this.buffers.delete(assetId); this.buffers.set(assetId, kept); return kept; }
    const asset = await db.localMediaAssets.get(assetId);
    const context = this.context;
    if (!asset || asset.kind !== 'audio' || !context) return null;
    try {
      const decoded = await context.decodeAudioData(await asset.blob.arrayBuffer());
      if (context === this.context) this.remember(assetId, decoded);
      return decoded;
    } catch { return null; }
  }

  private ensure(level: number) {
    if (!this.context) { this.context = new AudioContext(); this.master = this.context.createGain(); this.master.connect(this.context.destination); }
    this.master!.gain.value = level;
    return this.context;
  }

  /** Start (or switch to) a scene's loops, fading the previous ones out. */
  async listen(soundscape: Soundscape, scene: SoundScene): Promise<number> {
    const generation = ++this.generation;
    const context = this.ensure(soundscape.master); if (context.state === 'suspended') await context.resume();
    if (generation !== this.generation) return this.playing.length;
    this.listening = true;
    // Load every loop first, then swap: whatever played before fades only as the new loops begin,
    // and a call that was overtaken while loading (a second click, Stop) starts nothing.
    const loaded: { strip: SoundScene['strips'][number]; buffer: AudioBuffer }[] = [];
    for (const strip of scene.strips.filter(item => item.kind === 'loop')) {
      const buffer = await this.buffer(strip.assetId);
      if (generation !== this.generation) return this.playing.length;
      if (buffer) loaded.push({ strip, buffer });
    }
    const fadeOut = this.playing; this.playing = [];
    for (const item of fadeOut) { item.gain.gain.setTargetAtTime(0, context.currentTime, 0.35); try { item.source.stop(context.currentTime + 1.5); } catch { /* already stopped */ } }
    for (const { strip, buffer } of loaded) {
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; source.loop = true; gain.gain.value = 0; gain.gain.setTargetAtTime(strip.gain, context.currentTime, 0.35);
      source.connect(gain).connect(this.master!); source.start();
      this.playing.push({ source, gain, stripId: strip.id });
    }
    return this.playing.length;
  }

  /** Fire a one-shot once over whatever is playing. */
  async fire(soundscape: Soundscape, assetId: string, level: number): Promise<boolean> {
    const context = this.ensure(soundscape.master); if (context.state === 'suspended') await context.resume();
    const buffer = await this.buffer(assetId); if (!buffer) return false;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = level; source.connect(gain).connect(this.master!); source.start();
    return true;
  }

  level(stripId: string, value: number) { const item = this.playing.find(entry => entry.stripId === stripId); if (item && this.context) item.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.05); }
  masterLevel(value: number) { if (this.master && this.context) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.05); }
  get layers() { return this.playing.length; }

  stop() {
    this.generation++;
    for (const item of this.playing) { try { item.source.stop(); } catch { /* already stopped */ } }
    this.playing = []; this.listening = false;
    void this.context?.close(); this.context = null; this.master = null; this.buffers.clear(); this.cachedBytes = 0;
  }
}
