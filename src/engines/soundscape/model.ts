// Soundscapes: named mixes of the project's sounds for scenes at the table or
// while writing — "Tormenta en el puerto": rain and sea looping, thunder and
// a bell to fire by hand. Each scene has its strips (a sound, loop or
// one-shot, and its level); one scene is live; a master level over all.
export type StripKind = 'loop' | 'oneshot';
export interface SoundStrip { id: string; assetId: string; kind: StripKind; gain: number }
export interface SoundScene { id: string; name: string; strips: SoundStrip[] }
export interface Soundscape { id: string; name: string; scenes: SoundScene[]; liveSceneId?: string; master: number }
export interface SoundscapeList { revision: number; items: Soundscape[] }

export const SOUNDSCAPE_LIMITS = { soundscapes: 50, scenes: 30, strips: 12 } as const;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createSoundscape(name: string): Soundscape {
  const scene: SoundScene = { id: crypto.randomUUID(), name: 'Escena 1', strips: [] };
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || 'Paisaje sonoro', scenes: [scene], liveSceneId: scene.id, master: 0.8 };
}

export function validateSoundscapes(items: Soundscape[]): void {
  if (items.length > SOUNDSCAPE_LIMITS.soundscapes) throw new Error('soundscape_limit');
  for (const item of items) {
    if (!item.name.trim() || item.scenes.length < 1 || item.scenes.length > SOUNDSCAPE_LIMITS.scenes) throw new Error('soundscape_shape');
    if (item.liveSceneId && !item.scenes.some(scene => scene.id === item.liveSceneId)) throw new Error('soundscape_live');
    for (const scene of item.scenes) if (!scene.name.trim() || scene.strips.length > SOUNDSCAPE_LIMITS.strips || scene.strips.some(strip => !strip.assetId || (strip.kind !== 'loop' && strip.kind !== 'oneshot'))) throw new Error('soundscape_strips');
  }
}

/** Levels within 0–1 and names trimmed, so a stored mix always plays. */
export function normalizeSoundscape(item: Soundscape): Soundscape {
  return { ...item, name: item.name.trim().slice(0, 80), master: clamp(item.master), scenes: item.scenes.map(scene => ({ ...scene, name: scene.name.trim().slice(0, 80), strips: scene.strips.map(strip => ({ ...strip, gain: clamp(strip.gain) })) })) };
}
