import {writingSelection,manuscriptProject} from '@/engines/writings/manuscripts';
import {listEraRows} from '@/services/worldEras/store';
import type {Writing} from '@/types';
// ============================================
// AI bridge — the project's publishing profiles
// ============================================
// What the Publishing panel of project tools holds: named compilations of the
// manuscript (which pieces, in which order, with which front and back
// matter). The bridge lists them, creates or changes one as the profile
// dialog does, and compiles one to Markdown or HTML text for reading back —
// downloading a file stays with the person in the app.

import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import type { PublishingFormat, PublishingProfile } from '@/types/projectTools';
import {
  preparePublishingArtifacts,
  getPublishingProfiles,
  normalizePublishingProfile,
  resolvePublishingWritings,
  getCitations,
  savePublishingProfile,
  validatePublishingLayout,
} from '@/services/projectTools';
import { capturePublishingBatch, encodePublishingBatch, PUBLISHING_BATCH_OUTPUTS, type PublishingBatchOutput } from '@/engines/writings/publishingBatch';
import { PUBLISHING_EXPORT_TIMEOUT_MS } from '../manifest';
import { BOOK_PRESETS, bookPreset, normalizeBookStyle, type BookPreset } from '@/engines/writings/bookStyle';
import { BridgeError } from './bridgeError';
import { assertRowInScope, resolveProjectId, withAudit, type ToolArgs } from './shared';

const FORMATS: readonly PublishingFormat[] = ['manuscript', 'screenplay', 'research', 'biography', 'video'];
const FLAGS = ['includeTitlePage', 'includeCover', 'includeToc', 'includeCopyright', 'includeBlurb', 'includeChapterImages', 'includeInlineImages', 'includeSynopsis', 'includeBibliography'] as const;
const STYLES = ['apa', 'mla', 'chicago'] as const;

function summary(profile: PublishingProfile, writingCount: number) {
  const normal = normalizePublishingProfile(profile);
  return {
    id: profile.id,
    writingScope:writingSelection(profile.writingScope),
    name: profile.name,
    format: profile.format,
    includeTitlePage: profile.includeTitlePage,
    includeCover: !!profile.includeCover,
    includeToc: !!profile.includeToc,
    includeCopyright: !!profile.includeCopyright,
    includeBlurb: !!profile.includeBlurb,
    includeChapterImages: !!profile.includeChapterImages,
    includeInlineImages: !!profile.includeInlineImages,
    includeSynopsis: profile.includeSynopsis,
    includeBibliography: profile.includeBibliography,
    citationStyle: profile.citationStyle,
    bookStyle: profile.bookStyle ?? null,
    ...(profile.marginsMm ? { marginsMm: profile.marginsMm } : {}),
    ...(profile.initialPageNumber !== undefined ? { initialPageNumber: profile.initialPageNumber } : {}),
    selectionMode: normal.selectionMode,
    selectedWritingIds: normal.selectedWritingIds,
    writingOrder: normal.writingOrder,
    pieces: writingCount,
    updatedAt: profile.updatedAt,
  };
}

/** Every publishing profile of a project, with the pieces each would compile. */
export async function whPublishingProfiles(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const [profiles, writings, project] = await Promise.all([
    getPublishingProfiles(projectId),
    db.writings.where('projectId').equals(projectId).toArray(),
    db.projects.get(projectId),
  ]);
  return {
    projectId,
    author: project?.author ?? null,
    hasBlurb: !!project?.blurb?.trim(),
    profiles: profiles.map(profile => summary(profile, resolvePublishingWritings(writings, profile).writings.length)),
  };
}

/** Create a profile, or change the fields given on one. Undoable. */
export async function whPublishingProfileSet(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const id = typeof args.profileId === 'string' && args.profileId ? args.profileId : undefined;
  const existing = id ? await db.publishingProfiles.get(id) : undefined;
  if (id && (!existing || existing.projectId !== projectId)) throw new BridgeError('not-found', 'No publishing profile with that id in this project.');
  const next: Omit<PublishingProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } = existing
    ? { ...existing }
    : { projectId, name: '', format: 'manuscript', includeTitlePage: true, includeToc: false, includeCopyright: false, includeBlurb: false, includeSynopsis: false, includeBibliography: false, citationStyle: 'chicago', selectionMode: 'all', selectedWritingIds: [], writingOrder: [] };
  if(args.writingScope!==undefined)next.writingScope=writingSelection(args.writingScope);
  if (args.name !== undefined) {
    if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 120) throw new BridgeError('bad-args', 'name is 1 to 120 characters.');
    next.name = args.name.trim();
  }
  if (!next.name) throw new BridgeError('bad-args', 'A new profile needs a name.');
  if (args.format !== undefined) {
    if (!FORMATS.includes(args.format as PublishingFormat)) throw new BridgeError('bad-args', `format is one of ${FORMATS.join(', ')}.`);
    next.format = args.format as PublishingFormat;
  }
  for (const flag of FLAGS) {
    if (args[flag] === undefined) continue;
    if (typeof args[flag] !== 'boolean') throw new BridgeError('bad-args', `${flag} is true or false.`);
    next[flag] = args[flag] as boolean;
  }
  if (args.citationStyle !== undefined) {
    if (!STYLES.includes(args.citationStyle as typeof STYLES[number])) throw new BridgeError('bad-args', 'citationStyle is apa, mla or chicago.');
    next.citationStyle = args.citationStyle as typeof STYLES[number];
  }
  const ids = (key: 'selectedWritingIds' | 'writingOrder') => {
    const value = args[key];
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || value.length > 2000) throw new BridgeError('bad-args', `${key} is a list of writing ids.`);
    next[key] = value as string[];
  };
  ids('selectedWritingIds');
  ids('writingOrder');
  if (args.selectionMode !== undefined) {
    if (args.selectionMode !== 'all' && args.selectionMode !== 'selected') throw new BridgeError('bad-args', 'selectionMode is all or selected.');
    next.selectionMode = args.selectionMode;
  } else if (args.selectedWritingIds !== undefined) next.selectionMode = 'selected'; // a list of pieces means those pieces
  if (args.bookStyle !== undefined) {
    if (args.bookStyle === null || args.bookStyle === 'none') next.bookStyle = undefined;
    else if (typeof args.bookStyle === 'string') {
      if (!BOOK_PRESETS.includes(args.bookStyle as BookPreset)) throw new BridgeError('bad-args', `bookStyle is a preset (${BOOK_PRESETS.join(', ')}), "none", or an object of settings.`);
      next.bookStyle = bookPreset(args.bookStyle as BookPreset);
    } else {
      // A preset named in the object is the starting point; the other settings change it.
      const named = (args.bookStyle as { preset?: unknown }).preset;
      const base = BOOK_PRESETS.includes(named as BookPreset) ? bookPreset(named as BookPreset) : next.bookStyle ?? bookPreset('classic');
      const overrides = Object.keys(args.bookStyle as object).some(key => key !== 'preset');
      const merged = normalizeBookStyle({ ...base, ...(args.bookStyle as object), preset: BOOK_PRESETS.includes(named as BookPreset) && !overrides ? named : 'custom' });
      if (!merged) throw new BridgeError('bad-args', 'bookStyle settings must be an object.');
      next.bookStyle = merged;
    }
  }
  if (existing) next.id = existing.id;
  if (args.marginsMm !== undefined) next.marginsMm = args.marginsMm === null ? undefined : args.marginsMm as PublishingProfile['marginsMm'];
  if (args.initialPageNumber !== undefined) next.initialPageNumber = args.initialPageNumber === null ? undefined : args.initialPageNumber as number;
  try { validatePublishingLayout(next); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  let saved: PublishingProfile;
  try { saved = await savePublishingProfile(next); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  notifyProjectsChanged();
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  return withAudit(
    { projectId, created: !existing, profile: summary(saved, resolvePublishingWritings(writings, saved).writings.length) },
    { projectId, entityId: saved.id, kind: existing ? 'update' : 'create', summary: `${existing ? 'updated' : 'created'} publishing profile "${saved.name}"`, before: { __publishingProfile: existing ?? null, __publishingProfileId: saved.id } },
  );
}

const activeExports = new Map<string, AbortController>();

function exportJob(args: ToolArgs) {
  const projectId = resolveProjectId(args);
  assertRowInScope(args, projectId);
  if (typeof args.jobId !== 'string' || !args.jobId.trim()) throw new BridgeError('bad-args', 'jobId must be a nonempty client-generated id, known before starting the call.');
  return { projectId, jobId: args.jobId, key: JSON.stringify([projectId, args.jobId]) };
}

function inlineProfile(value: unknown, projectId: string, jobId: string): PublishingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('bad-args', 'draft must be a publishing profile object.');
  const draft = structuredClone(value) as Partial<PublishingProfile>;
  if (draft.projectId !== undefined && draft.projectId !== projectId) throw new BridgeError('scope', 'The draft belongs to another project.');
  if (typeof draft.name !== 'string' || !draft.name.trim()) throw new BridgeError('bad-args', 'draft.name is required.');
  if (draft.format !== undefined && !FORMATS.includes(draft.format)) throw new BridgeError('bad-args', 'Invalid publishing format.');
  for (const flag of FLAGS) if (draft[flag] !== undefined && typeof draft[flag] !== 'boolean') throw new BridgeError('bad-args', `${flag} is true or false.`);
  if (draft.citationStyle !== undefined && !STYLES.includes(draft.citationStyle)) throw new BridgeError('bad-args', 'Invalid citation style.');
  if (draft.selectionMode !== undefined && draft.selectionMode !== 'all' && draft.selectionMode !== 'selected') throw new BridgeError('bad-args', 'Invalid selectionMode.');
  for (const key of ['selectedWritingIds', 'writingOrder'] as const) if (draft[key] !== undefined && (!Array.isArray(draft[key]) || draft[key]!.some(id => typeof id !== 'string'))) throw new BridgeError('bad-args', `${key} is a list of writing ids.`);
  const result: PublishingProfile = {
    id: jobId, projectId, name: draft.name.trim(), format: 'manuscript',
    includeTitlePage: true, includeSynopsis: false, includeBibliography: false,
    citationStyle: 'chicago', selectedWritingIds: [], createdAt: 0, updatedAt: 0,
    ...draft, writingScope: writingSelection(draft.writingScope),
  };
  // Use the same style normalization as the saved-profile entry point.
  const style: unknown = draft.bookStyle;
  if (style === null || style === 'none') result.bookStyle = undefined;
  else if (typeof style === 'string') {
    if (!BOOK_PRESETS.includes(style as BookPreset)) throw new BridgeError('bad-args', 'Invalid bookStyle preset.');
    result.bookStyle = bookPreset(style as BookPreset);
  } else if (style !== undefined) {
    result.bookStyle = normalizeBookStyle(style);
    if (!result.bookStyle) throw new BridgeError('bad-args', 'bookStyle must be a preset, an object or none.');
  }
  if (draft.marginsMm === null) result.marginsMm = undefined;
  if (draft.initialPageNumber === null) result.initialPageNumber = undefined;
  try { return normalizePublishingProfile(result); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
  return btoa(binary);
}

/** Stateless by design: a new call always captures current persisted data. */
export async function whPublishingExport(args: ToolArgs): Promise<unknown> {
  const { projectId, jobId, key } = exportJob(args);
  if (activeExports.has(key)) throw new BridgeError('busy', 'This export jobId is already active in this project.');
  if (!Array.isArray(args.outputs) || !args.outputs.length || args.outputs.some(output => !PUBLISHING_BATCH_OUTPUTS.includes(output as PublishingBatchOutput))) throw new BridgeError('bad-args', `outputs is a nonempty list of ${PUBLISHING_BATCH_OUTPUTS.join(', ')}.`);
  const outputs = [...new Set(args.outputs as PublishingBatchOutput[])];
  if ((typeof args.profileId === 'string' && !!args.profileId) === (args.draft !== undefined)) throw new BridgeError('bad-args', 'Provide exactly one of profileId or draft.');
  if (args.eraId !== undefined && typeof args.eraId !== 'string') throw new BridgeError('bad-args', 'eraId is a string.');
  const request = structuredClone({
    projectId, profileId: typeof args.profileId === 'string' ? args.profileId : undefined,
    profile: args.draft === undefined ? undefined : inlineProfile(args.draft, projectId, jobId),
    eraId: args.eraId as string | undefined,
    titleOverride: typeof args.titleOverride === 'string' ? args.titleOverride : undefined,
    printLayout: args.printLayout as Parameters<typeof capturePublishingBatch>[0]['printLayout'],
  });
  const controller = new AbortController();
  activeExports.set(key, controller);
  // Leave cleanup time before the existing executor's declared tool timeout.
  const timer = setTimeout(() => controller.abort(new DOMException('Export deadline exceeded', 'TimeoutError')), PUBLISHING_EXPORT_TIMEOUT_MS - 5000);
  let stage = 'capture';
  try {
    const capture = await capturePublishingBatch(request, { signal: controller.signal });
    stage = 'encode';
    const files = await encodePublishingBatch(capture, outputs, { signal: controller.signal });
    return {
      projectId, jobId, profileId: capture.profileId, capturedAt: capture.capturedAt,
      stage, canceled: controller.signal.aborted, deadlineExceeded: controller.signal.reason?.name === 'TimeoutError',
      retry: 'A new call recaptures persisted data; completed jobIds do not retain a snapshot.',
      pieces: capture.pieces, wordCount: capture.wordCount, missingWritingIds: capture.missingWritingIds,
      files: files.map(({ bytes, ...file }) => ({ ...file, ...(bytes ? { byteLength: bytes.length, base64: base64Bytes(bytes) } : {}) })),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new BridgeError(controller.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'canceled', `${controller.signal.reason?.message ?? 'Export canceled'} during ${stage}.`);
    throw error;
  } finally {
    clearTimeout(timer);
    activeExports.delete(key);
  }
}

/** A sibling call can stop a blocked WASM worker using the id known beforehand. */
export async function whPublishingCancelExport(args: ToolArgs): Promise<unknown> {
  const { projectId, jobId, key } = exportJob(args);
  const controller = activeExports.get(key);
  controller?.abort(new DOMException('Export canceled', 'AbortError'));
  return { projectId, jobId, active: !!controller, canceled: !!controller };
}

const MAX_TEXT = 200_000;

/** The profile compiled as the export would write it, as Markdown or HTML text. */
export async function whPublishingCompile(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project not found.');
  const profile = typeof args.profileId === 'string' ? await db.publishingProfiles.get(args.profileId) : undefined;
  if (!profile || profile.projectId !== projectId) throw new BridgeError('not-found', 'No publishing profile with that id in this project.');
  const output = args.output === 'html' ? 'html' : 'markdown';
  if (args.complete !== undefined && typeof args.complete !== 'boolean') throw new BridgeError('bad-args', 'complete is true or false.');
  const eraId=typeof args.eraId==='string'?args.eraId:undefined;
  const writings = eraId?await listEraRows<Writing>({projectId,eraId},'writings'):await db.writings.where('projectId').equals(projectId).toArray();
  const resolved = resolvePublishingWritings(writings, profile);
  if (!resolved.writings.length) throw new BridgeError('bad-args', 'This profile compiles no pieces.');
  const citations = profile.includeBibliography ? await getCitations(projectId) : [];
  const artifacts = await preparePublishingArtifacts(manuscriptProject(project,profile.writingScope,eraId), profile, resolved.writings, citations);
  const text = output === 'html' ? artifacts.html : artifacts.markdown;
  const complete = args.complete === true || (output === 'html' && profile.includeCover === true);
  return {
    projectId,
    profileId: profile.id,
    output,
    filename: output === 'html' ? artifacts.htmlFilename : artifacts.markdownFilename,
    pieces: resolved.writings.length,
    wordCount: artifacts.document.wordCount,
    author: artifacts.document.author ?? null,
    copyright: artifacts.document.copyright ?? null,
    blurb: artifacts.document.blurb ? true : false,
    bookStyle: artifacts.document.bookStyle?.preset ?? null,
    cover: artifacts.document.cover ? { width: artifacts.document.cover.width, height: artifacts.document.cover.height } : null,
    missingWritingIds: resolved.missingWritingIds,
    characters: text.length,
    truncated: !complete && text.length > MAX_TEXT,
    text: complete ? text : text.slice(0, MAX_TEXT),
  };
}
