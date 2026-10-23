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
  buildPublishingArtifacts,
  getPublishingProfiles,
  normalizePublishingProfile,
  resolvePublishingWritings,
  getCitations,
  savePublishingProfile,
} from '@/services/projectTools';
import { BOOK_PRESETS, bookPreset, normalizeBookStyle, type BookPreset } from '@/engines/writings/bookStyle';
import { BridgeError } from './bridgeError';
import { resolveProjectId, withAudit, type ToolArgs } from './shared';

const FORMATS: readonly PublishingFormat[] = ['manuscript', 'screenplay', 'research', 'biography', 'video'];
const FLAGS = ['includeTitlePage', 'includeToc', 'includeCopyright', 'includeBlurb', 'includeChapterImages', 'includeInlineImages', 'includeSynopsis', 'includeBibliography'] as const;
const STYLES = ['apa', 'mla', 'chicago'] as const;

function summary(profile: PublishingProfile, writingCount: number) {
  const normal = normalizePublishingProfile(profile);
  return {
    id: profile.id,
    name: profile.name,
    format: profile.format,
    includeTitlePage: profile.includeTitlePage,
    includeToc: !!profile.includeToc,
    includeCopyright: !!profile.includeCopyright,
    includeBlurb: !!profile.includeBlurb,
    includeChapterImages: !!profile.includeChapterImages,
    includeInlineImages: !!profile.includeInlineImages,
    includeSynopsis: profile.includeSynopsis,
    includeBibliography: profile.includeBibliography,
    citationStyle: profile.citationStyle,
    bookStyle: profile.bookStyle ?? null,
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
  let saved: PublishingProfile;
  try { saved = await savePublishingProfile(next); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  notifyProjectsChanged();
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  return withAudit(
    { projectId, created: !existing, profile: summary(saved, resolvePublishingWritings(writings, saved).writings.length) },
    { projectId, entityId: saved.id, kind: existing ? 'update' : 'create', summary: `${existing ? 'updated' : 'created'} publishing profile "${saved.name}"`, before: { __publishingProfile: existing ?? null, __publishingProfileId: saved.id } },
  );
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
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  const resolved = resolvePublishingWritings(writings, profile);
  if (!resolved.writings.length) throw new BridgeError('bad-args', 'This profile compiles no pieces.');
  const citations = profile.includeBibliography ? await getCitations(projectId) : [];
  const artifacts = buildPublishingArtifacts(project, profile, resolved.writings, citations);
  const text = output === 'html' ? artifacts.html : artifacts.markdown;
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
    missingWritingIds: resolved.missingWritingIds,
    truncated: text.length > MAX_TEXT,
    text: text.slice(0, MAX_TEXT),
  };
}
