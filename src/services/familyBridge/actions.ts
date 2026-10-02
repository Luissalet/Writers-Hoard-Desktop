// ============================================================================
// Family bridge — the four hand-offs, shared by the bridge tools and the buttons
// ============================================================================
//
//   sendCharacterToProspero     codex character  → Prospero's cast
//   sendStoryboardToProspero    storyboard       → a Prospero production draft
//   sendWorldToScheherazade     the project's world → a Scheherazade world
//   fetchWorldFromScheherazade  a Scheherazade world → this project's codex, relationships, timeline
//
// Each throws a FamilyActionError whose `code` and message say what to do about
// it ("Prospero is not running…"); the bridge tools turn that into a BridgeError
// and the buttons into an error toast, so a model and a person read the same
// sentence. Nothing here deletes or overwrites the writer's data: the two
// outbound calls only read, and the import follows worldImport.ts's rules.

import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { callFamily, linkRefs } from './client';
import { dataUrlToPngBase64 } from './images';
import { buildCharacterPayload, buildStoryboardPayload, type Picture } from './prospero';
import { APP_LABEL, FILE_PLACEHOLDER, type FamilyCallApp, type FamilyCallFile, type FamilyCallResponse } from './protocol';
import { importWorldDoc, rememberFamilyRefs, type ImportResult } from './worldImport';
import { loadWorldDoc } from './worldExport';
import { WorldDocumentError, refCodex, refOk, refProject, refStoryboard } from './worldSchema';

export class FamilyActionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FamilyActionError';
    this.code = code;
  }
}

type Failure = Extract<FamilyCallResponse, { ok: false }>;

/** The sentence a person (or a model) should read for a failed call. */
export function describeFailure(app: FamilyCallApp, tool: string, failure: Failure): FamilyActionError {
  const name = APP_LABEL[app];
  switch (failure.code) {
    case 'desktop-only':
      return new FamilyActionError('desktop-only', failure.error);
    case 'hub_unreachable':
      return new FamilyActionError('hub-unreachable', `${failure.error} Start the Hoard hub and ${name}, then try again.`);
    case 'app_unavailable':
      return new FamilyActionError('app-unavailable', `${name} is not running or not connected to the hub (${failure.error}). Start ${name} and try again.`);
    case 'unauthorized':
      return new FamilyActionError('unauthorized', `${failure.error} Open Writers Hoard's AI bridge settings and check the token is the one the hub knows.`);
    case 'timeout':
      return new FamilyActionError('timeout', `${name} did not answer in time. It may still be working: check it before sending again.`);
    case 'tool_failed':
      return new FamilyActionError('tool-failed', `${name} refused ${tool}: ${failure.error}`);
    case 'bad-request':
      return new FamilyActionError('bad-request', failure.error);
    default:
      return new FamilyActionError('failed', `${name}: ${failure.error}`);
  }
}

/** The pictures as PNG files for main, and the placeholders that survived the conversion. */
async function toFiles(pictures: Picture[]): Promise<{ files: FamilyCallFile[]; sent: Set<string> }> {
  const files: FamilyCallFile[] = [];
  for (const picture of pictures) {
    const base64 = await dataUrlToPngBase64(picture.dataUrl);
    if (base64) files.push({ id: picture.id, base64 });
  }
  return { files, sent: new Set(files.map(file => file.id)) };
}

function idOf(result: unknown, keys: string[]): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

const safeId = (id: string): string => encodeURIComponent(id).replace(/%/g, '_');

// ---------------------------------------------------------------------------
// Prospero
// ---------------------------------------------------------------------------

export interface SentToProspero {
  /** What Prospero made: the cast member's or the production's id, when it said. */
  remoteId?: string;
  remoteRef?: string;
  sourceRef: string;
  picturesSent: number;
  picturesSkipped: number;
  /** Whether the hub recorded the link between the two records. */
  linked: boolean;
  answer: unknown;
}

export async function sendCharacterToProspero(projectId: string, characterId: string): Promise<SentToProspero & { name: string }> {
  const entry = await db.codexEntries.get(characterId);
  if (!entry) throw new FamilyActionError('not-found', `No codex entry with id "${characterId}".`);
  if (entry.projectId !== projectId) throw new FamilyActionError('scope', `The codex entry "${characterId}" belongs to another project.`);
  if (entry.type !== 'character') throw new FamilyActionError('bad-args', `"${entry.title}" is a ${entry.type}, not a character; only characters go to Prospero's cast.`);

  const sourceRef = refCodex(entry.id);
  const gallery = await db.inspirationImages.where('linkedEntryIds').equals(entry.id).toArray();
  const payload = buildCharacterPayload(entry, sourceRef, gallery);
  const { files, sent } = await toFiles(payload.pictures);
  const args = { ...payload.args, images: payload.args.images.filter(placeholder => sent.has(placeholder.slice(FILE_PLACEHOLDER.length))) };
  if (!args.images.length) delete (args as { images?: string[] }).images;

  const answer = await callFamily('prospero', 'cast_import_character', args, { files, timeoutS: 90 });
  if (!answer.ok) throw describeFailure('prospero', 'cast_import_character', answer);
  const remoteId = idOf(answer.result, ['character_id', 'id']);
  const remoteRef = remoteId ? `hoard://prospero/character/${safeId(remoteId)}` : undefined;
  const linked = remoteRef ? await linkRefs({ from: sourceRef, to: remoteRef, rel: 'sent_to', fromLabel: entry.title, toLabel: entry.title }) : false;
  return {
    name: payload.args.name, remoteId, remoteRef, sourceRef, picturesSent: files.length, picturesSkipped: payload.pictures.length - files.length, linked, answer: answer.result,
  };
}

export async function sendStoryboardToProspero(projectId: string, storyboardId: string): Promise<SentToProspero & { title: string; shots: number; picturesDropped: number }> {
  const board = await db.storyboards.get(storyboardId);
  if (!board) throw new FamilyActionError('not-found', `No storyboard with id "${storyboardId}".`);
  if (board.projectId !== projectId) throw new FamilyActionError('scope', `The storyboard "${storyboardId}" belongs to another project.`);
  const panels = await db.storyboardPanels.where('storyboardId').equals(storyboardId).toArray();
  if (!panels.length) throw new FamilyActionError('empty', `The storyboard "${board.title}" has no panels, so there are no shots to send.`);

  const refIds = [...new Set(panels.filter(panel => !panel.imageData && panel.imageRef).map(panel => panel.imageRef as string))];
  const gallery = new Map((await db.inspirationImages.bulkGet(refIds)).filter(Boolean).map(image => [image!.id, image!]));
  const sourceRef = refStoryboard(board.id);
  const payload = buildStoryboardPayload(board.title, panels, sourceRef, panel => {
    if (panel.imageData?.startsWith('data:')) return panel.imageData;
    const image = panel.imageRef ? gallery.get(panel.imageRef) : undefined;
    return image?.imageData || image?.thumbnailData;
  });
  const { files, sent } = await toFiles(payload.pictures);
  const shots = payload.args.shots.map(shot => {
    if (!shot.image || sent.has(shot.image.slice(FILE_PLACEHOLDER.length))) return shot;
    const { image: _skipped, ...rest } = shot; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });

  const answer = await callFamily('prospero', 'production_from_storyboard', { ...payload.args, shots }, { files, timeoutS: 180 });
  if (!answer.ok) throw describeFailure('prospero', 'production_from_storyboard', answer);
  const remoteId = idOf(answer.result, ['production_id', 'id', 'production']);
  const remoteRef = remoteId ? `hoard://prospero/production/${safeId(remoteId)}` : undefined;
  const linked = remoteRef ? await linkRefs({ from: sourceRef, to: remoteRef, rel: 'sent_to', fromLabel: board.title, toLabel: board.title }) : false;
  return {
    title: board.title, shots: shots.length, remoteId, remoteRef, sourceRef, picturesSent: files.length,
    picturesSkipped: payload.pictures.length - files.length, picturesDropped: payload.picturesDropped, linked, answer: answer.result,
  };
}

// ---------------------------------------------------------------------------
// Scheherazade
// ---------------------------------------------------------------------------

export interface SentWorld {
  /** What was in the document. */
  sent: Record<string, number>;
  skipped: Record<string, number>;
  /** Scheherazade's answer: the world it filed this in and how each record fared. */
  world?: { id?: string; name?: string };
  worldCreated?: boolean;
  worldRef?: string;
  counts?: Record<string, number>;
  items?: unknown[];
  linked: boolean;
  projectTitle: string;
}

export async function sendWorldToScheherazade(projectId: string, options: { worldId?: string; includeSecret?: boolean } = {}): Promise<SentWorld> {
  let built;
  try {
    built = await loadWorldDoc(projectId, { includeSecret: options.includeSecret });
  } catch (error) {
    if (error instanceof WorldDocumentError) throw new FamilyActionError('bad-args', error.message);
    throw error;
  }
  const total = Object.values(built.counts).reduce((sum, count) => sum + count, 0);
  if (!total) {
    throw new FamilyActionError('empty', `"${built.projectTitle}" has no codex entries, relationships or timeline events to send yet.`);
  }
  const args: Record<string, unknown> = { data: built.doc };
  if (options.worldId) args.world_id = options.worldId;
  const answer = await callFamily('scheherazade', 'world_import', args, { timeoutS: 120 });
  if (!answer.ok) throw describeFailure('scheherazade', 'world_import', answer);
  const result = (answer.result && typeof answer.result === 'object' ? answer.result : {}) as Record<string, unknown>;
  const world = result.world && typeof result.world === 'object' ? (result.world as { id?: string; name?: string }) : undefined;
  const worldRef = typeof result.world_ref === 'string' && refOk(result.world_ref) ? result.world_ref : undefined;
  // These records now live in Scheherazade too: if one comes back and the writer deleted it here, it stays deleted.
  const doc = built.doc;
  await rememberFamilyRefs(projectId, [...doc.characters ?? [], ...doc.places ?? [], ...doc.factions ?? [], ...doc.things ?? []].map(item => item.ref), 'codex');
  await rememberFamilyRefs(projectId, (doc.relations ?? []).map(item => item.ref), 'relation');
  await rememberFamilyRefs(projectId, (doc.events ?? []).map(item => item.ref), 'event');
  const linked = worldRef ? await linkRefs({ from: refProject(projectId), to: worldRef, rel: 'sent_to', fromLabel: built.projectTitle, toLabel: world?.name ?? built.projectTitle }) : false;
  return {
    sent: built.counts, skipped: built.skipped, world, worldCreated: result.world_created === true, worldRef,
    counts: result.counts as Record<string, number> | undefined, items: Array.isArray(result.items) ? result.items : undefined,
    linked, projectTitle: built.projectTitle,
  };
}

export interface FetchedWorld extends ImportResult {
  linked: boolean;
}

export async function fetchWorldFromScheherazade(projectId: string, worldId: string): Promise<FetchedWorld> {
  const project = await db.projects.get(projectId);
  if (!project) throw new FamilyActionError('not-found', `No project with id "${projectId}".`);
  if (!project.enabledEngines.includes('codex')) {
    throw new FamilyActionError('engine-disabled', `The codex engine is switched off in "${project.title}", so an imported world would be invisible there. Switch it on (wh_enable_engine) and try again.`);
  }
  const answer = await callFamily('scheherazade', 'world_export', { world_id: worldId }, { timeoutS: 120 });
  if (!answer.ok) throw describeFailure('scheherazade', 'world_export', answer);
  let result: ImportResult;
  try {
    result = await importWorldDoc(projectId, answer.result, {
      relationships: project.enabledEngines.includes('relationships'),
      timeline: project.enabledEngines.includes('timeline'),
    });
  } catch (error) {
    if (error instanceof WorldDocumentError) throw new FamilyActionError('bad-response', `Scheherazade's answer is not a story world: ${error.message}`);
    throw error;
  }
  const changed = result.created.codex.length + result.created.relationships.length + result.created.events.length + result.updatedIds.length;
  if (changed) notifyDataChanged({ source: 'import', tool: 'wh_world_from_scheherazade', projectId });
  const worldRef = result.world.ref;
  const linked = changed && refOk(worldRef)
    ? await linkRefs({ from: refProject(projectId), to: worldRef, rel: 'imported_from', fromLabel: project.title, toLabel: result.world.name })
    : false;
  return { ...result, linked };
}
