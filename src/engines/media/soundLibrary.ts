// ============================================
// Sound library — ambience and effects made on this device
// ============================================
// A small built-in library for chapter soundtracks that needs no download and
// carries no licence: each sound is synthesised from noise and tones (rain,
// wind, fire, sea, a night forest, a tavern, thunder, a bell, a heartbeat,
// footsteps, a knock, swords), rendered to a WAV file and added to the
// project's sounds like any imported one.

import { db } from '@/db';
import type { LocalMediaAsset } from './types';

export const SOUND_CATEGORIES = ['ambience', 'weather', 'effect'] as const;
export type SoundCategory = typeof SOUND_CATEGORIES[number];
export const SOUND_CATEGORY_LABELS: Record<SoundCategory, { es: string; en: string }> = { ambience: { es: 'Ambiente', en: 'Ambience' }, weather: { es: 'Clima', en: 'Weather' }, effect: { es: 'Efecto', en: 'Effect' } };

const RATE = 22050;

/** A seeded generator, so a sound is the same every time it is made. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lowpass = (input: Float32Array, amount: number) => { let last = 0; for (let i = 0; i < input.length; i++) { last += amount * (input[i] - last); input[i] = last; } return input; };
const noise = (length: number, rnd: () => number) => Float32Array.from({ length }, () => rnd() * 2 - 1);
const fade = (out: Float32Array, seconds = 0.4) => { const n = Math.min(out.length / 2, Math.floor(seconds * RATE)); for (let i = 0; i < n; i++) { const g = i / n; out[i] *= g; out[out.length - 1 - i] *= g; } return out; };
const normalize = (out: Float32Array, peak = 0.8) => { let max = 0; for (const v of out) max = Math.max(max, Math.abs(v)); if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / max; return out; };
const burst = (out: Float32Array, at: number, seconds: number, rnd: () => number, gain: number, smooth: number) => { const n = Math.floor(seconds * RATE), start = Math.floor(at * RATE); let last = 0; for (let i = 0; i < n && start + i < out.length; i++) { last += smooth * ((rnd() * 2 - 1) - last); out[start + i] += last * gain * Math.exp(-5 * i / n); } };
const tone = (out: Float32Array, at: number, seconds: number, frequency: number, gain: number, decay = 4) => { const n = Math.floor(seconds * RATE), start = Math.floor(at * RATE); for (let i = 0; i < n && start + i < out.length; i++) out[start + i] += Math.sin(2 * Math.PI * frequency * i / RATE) * gain * Math.exp(-decay * i / n); };

interface SoundDef { id: string; category: SoundCategory; es: string; en: string; seconds: number; loop: boolean; render: (length: number, rnd: () => number) => Float32Array }

export const SOUND_LIBRARY: SoundDef[] = [
  { id: 'rain', category: 'weather', es: 'Lluvia', en: 'Rain', seconds: 12, loop: true, render: (n, r) => { const out = lowpass(noise(n, r), 0.35); for (let k = 0; k < n / 400; k++) burst(out, r() * n / RATE, 0.02, r, 0.6, 0.6); return out; } },
  { id: 'wind', category: 'weather', es: 'Viento', en: 'Wind', seconds: 14, loop: true, render: (n, r) => { const out = lowpass(noise(n, r), 0.03); for (let i = 0; i < n; i++) out[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * i / (RATE * 4.7)) * Math.sin(2 * Math.PI * i / (RATE * 2.3)); return out; } },
  { id: 'thunder', category: 'weather', es: 'Trueno', en: 'Thunder', seconds: 6, loop: false, render: (n, r) => { const out = new Float32Array(n); burst(out, 0.05, 0.25, r, 1, 0.5); burst(out, 0.2, 5, r, 0.9, 0.02); return out; } },
  { id: 'fire', category: 'ambience', es: 'Hoguera', en: 'Campfire', seconds: 10, loop: true, render: (n, r) => { const out = lowpass(noise(n, r), 0.05); for (let i = 0; i < n; i++) out[i] *= 0.4; for (let k = 0; k < n / 1500; k++) burst(out, r() * n / RATE, 0.015, r, 1.4, 0.9); return out; } },
  { id: 'sea', category: 'ambience', es: 'Olas del mar', en: 'Sea waves', seconds: 16, loop: true, render: (n, r) => { const out = lowpass(noise(n, r), 0.08); for (let i = 0; i < n; i++) { const phase = (i / RATE) % 8 / 8; out[i] *= 0.15 + Math.pow(Math.sin(Math.PI * phase), 3); } return out; } },
  { id: 'night-forest', category: 'ambience', es: 'Bosque de noche', en: 'Night forest', seconds: 12, loop: true, render: (n, r) => { const out = lowpass(noise(n, r), 0.02); for (let i = 0; i < n; i++) out[i] *= 0.3; for (let t = 0; t < n / RATE; t += 0.35 + r() * 0.5) for (let c = 0; c < 3; c++) tone(out, t + c * 0.06, 0.04, 4200 + r() * 600, 0.25, 2); return out; } },
  { id: 'tavern', category: 'ambience', es: 'Taberna', en: 'Tavern', seconds: 14, loop: true, render: (n, r) => { const out = new Float32Array(n); const base = lowpass(noise(n, r), 0.06); for (let i = 0; i < n; i++) out[i] = base[i] * (0.5 + 0.3 * Math.sin(2 * Math.PI * i / (RATE * 1.3))); for (let t = 0.5; t < n / RATE; t += 1.5 + r() * 2.5) tone(out, t, 0.12, 2200 + r() * 800, 0.3, 6); return out; } },
  { id: 'heartbeat', category: 'effect', es: 'Latido', en: 'Heartbeat', seconds: 4, loop: true, render: (n) => { const out = new Float32Array(n); for (let t = 0; t < n / RATE; t += 1) { tone(out, t, 0.12, 55, 1, 5); tone(out, t + 0.25, 0.12, 50, 0.7, 5); } return out; } },
  { id: 'bell', category: 'effect', es: 'Campana', en: 'Bell', seconds: 5, loop: false, render: (n) => { const out = new Float32Array(n); for (const [f, g] of [[440, 1], [880, 0.5], [1320, 0.3], [1760, 0.2], [523, 0.25]] as const) tone(out, 0, 5, f, g, 3); return out; } },
  { id: 'footsteps', category: 'effect', es: 'Pasos', en: 'Footsteps', seconds: 4, loop: true, render: (n, r) => { const out = new Float32Array(n); for (let t = 0.1; t < n / RATE; t += 0.55) burst(out, t, 0.08, r, 1, 0.15); return out; } },
  { id: 'knock', category: 'effect', es: 'Llamada a la puerta', en: 'Knock at the door', seconds: 2, loop: false, render: (n, r) => { const out = new Float32Array(n); for (const t of [0.1, 0.4, 0.7]) { burst(out, t, 0.06, r, 1, 0.3); tone(out, t, 0.08, 140, 0.8, 8); } return out; } },
  { id: 'swords', category: 'effect', es: 'Choque de espadas', en: 'Sword clash', seconds: 2, loop: false, render: (n, r) => { const out = new Float32Array(n); for (const t of [0.1, 0.9]) { burst(out, t, 0.05, r, 1, 0.95); for (const f of [2600, 3900, 5200]) tone(out, t, 0.9, f + r() * 200, 0.3, 4); } return out; } },
];

/** The sound rendered as samples between -1 and 1. */
export function renderLibrarySound(id: string): Float32Array {
  const sound = SOUND_LIBRARY.find(item => item.id === id);
  if (!sound) throw new Error(`No library sound "${id}".`);
  const seed = Array.from(id).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261);
  const out = sound.render(Math.floor(sound.seconds * RATE), random(seed));
  return normalize(sound.loop ? fade(out, 0.25) : fade(out, 0.02));
}

/** 16-bit mono PCM WAV. */
export function wavBlob(samples: Float32Array, sampleRate = RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Add a library sound to the project's sounds (once: the same sound is reused). */
export async function addLibrarySound(projectId: string, id: string, locale: string): Promise<LocalMediaAsset> {
  const sound = SOUND_LIBRARY.find(item => item.id === id);
  if (!sound) throw new Error(`No library sound "${id}".`);
  const tag = `library:${id}`;
  const existing = await db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.tags.includes(tag)).first();
  if (existing) return existing;
  const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  const blob = wavBlob(renderLibrarySound(id));
  const now = Date.now();
  const asset: LocalMediaAsset = { id: crypto.randomUUID(), projectId, title: sound[lang], kind: 'audio', mime: 'audio/wav', blob, size: blob.size, notes: lang === 'es' ? `Biblioteca de sonidos (${SOUND_CATEGORY_LABELS[sound.category].es}), generado en este equipo.` : `Sound library (${SOUND_CATEGORY_LABELS[sound.category].en}), made on this device.`, tags: [tag, sound.category], linkedEntryIds: [], createdAt: now, updatedAt: now };
  await db.localMediaAssets.add(asset);
  return asset;
}
