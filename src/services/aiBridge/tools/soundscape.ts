// ============================================
// AI bridge — soundscapes
// ============================================
// Read and build the project's soundscapes as the mixer does: create one, add
// scenes, put project sounds (or library sounds, added on the way) on strips
// as loops or one-shots with a level, choose the live scene, set the master,
// remove. Playing is the listener's: the bridge never starts sound.

import { db } from '@/db';
import { SOUND_LIBRARY, addLibrarySound } from '@/engines/media/soundLibrary';
import { createSoundscape, type Soundscape } from '@/engines/soundscape/model';
import { SoundscapeConflict, readSoundscapes, saveSoundscapes } from '@/engines/soundscape/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { soundscapesStamp } from '../undoStamp';
import { BridgeError } from './bridgeError';
import { optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

export async function whSoundscape(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const before = await readSoundscapes(projectId), action = optString(args, 'action') ?? 'read';
  const titles = new Map((await db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.kind === 'audio').toArray()).map(asset => [asset.id, asset.title]));
  const shape = (items: Soundscape[]) => items.map(item => ({ id: item.id, name: item.name, master: item.master, liveSceneId: item.liveSceneId ?? null, scenes: item.scenes.map(scene => ({ id: scene.id, name: scene.name, strips: scene.strips.map(strip => ({ id: strip.id, assetId: strip.assetId, sound: titles.get(strip.assetId) ?? null, kind: strip.kind, gain: strip.gain })) })) }));
  if (action === 'read') return { revision: before.revision, soundscapes: shape(before.items), sounds: [...titles].map(([id, title]) => ({ id, title })), library: SOUND_LIBRARY.map(sound => sound.id) };
  const items = structuredClone(before.items);
  const find = () => { const id = optString(args, 'soundscapeId'); const found = id ? items.find(item => item.id === id) : items.length === 1 ? items[0] : undefined; if (!found) throw new BridgeError('not-found', `Give soundscapeId; soundscapes: ${items.map(item => `${item.name} (${item.id})`).join(', ') || 'none'}.`); return found; };
  const scene = (item: Soundscape) => { const id = optString(args, 'sceneId'); const found = id ? item.scenes.find(entry => entry.id === id) : item.scenes.find(entry => entry.id === item.liveSceneId) ?? item.scenes[0]; if (!found) throw new BridgeError('not-found', `No scene ${id}; scenes: ${item.scenes.map(entry => `${entry.name} (${entry.id})`).join(', ')}.`); return found; };
  const level = (key: string) => { const value = optNumber(args, key); if (value !== undefined && (value < 0 || value > 1)) throw new BridgeError('bad-args', `${key} is 0 to 1.`); return value; };
  let detail: Record<string, unknown> = {};
  switch (action) {
    case 'create': { const created = createSoundscape(requireString(args, 'name')); const lang = (optString(args, 'locale') ?? useLocaleStore.getState().locale).startsWith('en') ? 'en' : 'es'; created.scenes[0].name = optString(args, 'sceneName') ?? (lang === 'es' ? 'Escena 1' : 'Scene 1'); items.push(created); detail = { soundscapeId: created.id, sceneId: created.scenes[0].id }; break; }
    case 'add-scene': { const item = find(); const added = { id: crypto.randomUUID(), name: requireString(args, 'name'), strips: [] }; item.scenes.push(added); detail = { sceneId: added.id }; break; }
    case 'add-strip': {
      const item = find(), target = scene(item); let assetId = optString(args, 'assetId');
      const library = optString(args, 'librarySound');
      if (library) { if (!SOUND_LIBRARY.some(sound => sound.id === library)) throw new BridgeError('bad-args', `librarySound is one of ${SOUND_LIBRARY.map(sound => sound.id).join(', ')}.`); assetId = (await addLibrarySound(projectId, library, optString(args, 'locale') ?? useLocaleStore.getState().locale)).id; }
      if (!assetId || !(await db.localMediaAssets.get(assetId))) throw new BridgeError('not-found', 'Give assetId (a project sound from action read) or librarySound.');
      const kind = optString(args, 'kind') ?? 'loop'; if (kind !== 'loop' && kind !== 'oneshot') throw new BridgeError('bad-args', 'kind is loop or oneshot.');
      const strip = { id: crypto.randomUUID(), assetId, kind: kind as 'loop' | 'oneshot', gain: level('gain') ?? 0.7 }; target.strips.push(strip); detail = { stripId: strip.id, assetId }; break;
    }
    case 'set': {
      const item = find(); const master = level('master'); if (master !== undefined) item.master = master;
      if (optString(args, 'liveSceneId')) { if (!item.scenes.some(entry => entry.id === args.liveSceneId)) throw new BridgeError('not-found', 'No such scene.'); item.liveSceneId = String(args.liveSceneId); }
      const stripId = optString(args, 'stripId');
      if (stripId) { const strip = item.scenes.flatMap(entry => entry.strips).find(entry => entry.id === stripId); if (!strip) throw new BridgeError('not-found', 'No such strip.'); const gain = level('gain'); if (gain !== undefined) strip.gain = gain; const kind = optString(args, 'kind'); if (kind) { if (kind !== 'loop' && kind !== 'oneshot') throw new BridgeError('bad-args', 'kind is loop or oneshot.'); strip.kind = kind; } }
      break;
    }
    case 'remove': {
      const id = requireString(args, 'id');
      const at = items.findIndex(item => item.id === id);
      if (at >= 0) items.splice(at, 1);
      else { let found = false; for (const item of items) { if (item.scenes.some(entry => entry.id === id)) { if (item.scenes.length < 2) throw new BridgeError('bad-args', 'A soundscape keeps at least one scene.'); item.scenes = item.scenes.filter(entry => entry.id !== id); if (item.liveSceneId === id) item.liveSceneId = item.scenes[0].id; found = true; } for (const entry of item.scenes) if (entry.strips.some(strip => strip.id === id)) { entry.strips = entry.strips.filter(strip => strip.id !== id); found = true; } } if (!found) throw new BridgeError('not-found', 'No soundscape, scene or strip with that id.'); }
      break;
    }
    default: throw new BridgeError('bad-args', 'action is read, create, add-scene, add-strip, set or remove.');
  }
  try {
    const saved = await saveSoundscapes(projectId, items, before.revision);
    return withAudit({ revision: saved.revision, soundscapes: shape(saved.items), ...detail }, { projectId, entityId: projectId, kind: 'update', summary: `${action} in the soundscapes`, before: { __soundscapes: before, __after: soundscapesStamp(saved), __afterRevision: saved.revision } });
  } catch (error) {
    if (error instanceof SoundscapeConflict) throw new BridgeError('conflict', 'The soundscapes changed meanwhile; read them again.');
    throw new BridgeError('bad-args', error instanceof Error && error.message === 'soundscape_strips' ? 'Up to 12 strips per scene.' : error instanceof Error && error.message === 'soundscape_limit' ? 'Up to 50 soundscapes.' : 'Invalid soundscape.');
  }
}
