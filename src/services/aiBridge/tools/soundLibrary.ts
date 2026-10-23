// ============================================
// AI bridge — the built-in sound library
// ============================================
// Lists the sounds made on this device (ambience, weather, effects) and adds
// one to a project's sounds, returning the asset id to use as a chapter track
// or a paragraph cue in wh_reader_settings_save.

import { SOUND_CATEGORY_LABELS, SOUND_LIBRARY, addLibrarySound } from '@/engines/media/soundLibrary';
import { useLocaleStore } from '@/stores/localeStore';
import { BridgeError } from './bridgeError';
import { db } from '@/db';
import { optString, resolveProjectId, withAudit, type ToolArgs } from './shared';

export async function whSoundLibrary(args: ToolArgs): Promise<unknown> {
  const locale = optString(args, 'locale') ?? useLocaleStore.getState().locale;
  const lang = locale.startsWith('en') ? 'en' : 'es';
  const sounds = SOUND_LIBRARY.map(sound => ({ id: sound.id, name: sound[lang], category: sound.category, categoryName: SOUND_CATEGORY_LABELS[sound.category][lang], seconds: sound.seconds, loops: sound.loop }));
  const add = optString(args, 'add');
  if (!add) return { sounds };
  if (!SOUND_LIBRARY.some(sound => sound.id === add)) throw new BridgeError('bad-args', `No library sound "${add}". Sounds: ${SOUND_LIBRARY.map(sound => sound.id).join(', ')}.`);
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const had = await db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.tags.includes(`library:${add}`)).first();
  const asset = await addLibrarySound(projectId, add, lang);
  const result = { added: { assetId: asset.id, title: asset.title, mime: asset.mime, size: asset.size, alreadyThere: !!had }, sounds };
  // A sound added now can be undone (taken out of the project's sounds); one already there is left as it was.
  return had ? result : withAudit(result, { projectId, entityId: asset.id, table: 'localMediaAssets', kind: 'create', summary: `added the library sound "${asset.title}"` });
}
