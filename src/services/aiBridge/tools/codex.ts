// ============================================================================
// AI bridge tools — the codex (characters, places, items, factions, concepts)
// ============================================================================
//
// The real operations live in src/db/operations.ts, not in
// engines/codex/operations.ts — that file is dead code nothing imports.
//
// Two fields are deliberately out of reach: `avatar` (a base64 image the user
// crops in the app) and `relations` (an inert legacy field; real relations
// belong to the relationships engine).

import type { CodexEntry, CodexEntryType } from '@/types';
import { db } from '@/db';
import { saveCodexDraft } from '@/engines/codex/operations';
import { listEraRows, readEraRow, saveEraDocument } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import { missingRequiredProperties, projectCodexEntry, propertyDefinitions } from '@/engines/codex/properties';
import { applyCodexTemplate, saveCodexTemplate, deleteCodexTemplate, type CodexTemplate } from '@/engines/codex/templates';
import { effectiveCodexTemplate } from '@/engines/codex/templateHierarchy';
import {createLibraryCodex} from '@/components/project/workspace/library/createCodex';
import {WorkspaceLibraryConflict,WorkspaceLibraryInvalidAction} from '@/components/project/workspace/library/model';
import { applyTemplateSync, previewTemplateSync, type TemplateSyncOptions, type TemplateSyncPreview } from '@/engines/codex/templateSync';
import {
  createCodexEntry,
  getCodexEntries,
  getCodexEntry,
  updateCodexEntry,
} from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { aliasProblem, readAliases, replaceAliases, suggestAliases } from '@/services/codexReference/aliases';
import { genrePackTemplates, seedGenrePack } from '@/engines/codex/genrePacks';
import { CARD_GUIDES, cardGuide, guideAnswers } from '@/engines/codex/guides';
import { freezeCodexEntry } from '@/engines/codex/freeze';
import { isRevealed, readReveal } from '@/engines/codex/revealModel';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  EMPTY_CONTENT,
  htmlFromMarkdown,
  markdownFromHtml,
  optBoolean,
  optEnum,
  optString,
  optStringArray,
  optStringMap,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const TYPES = [
  'character', 'location', 'item', 'faction', 'concept', 'magic', 'custom',
] as const satisfies readonly CodexEntryType[];

async function mustGetEntry(id: string, args: ToolArgs): Promise<CodexEntry> {
  const eraId = optString(args, 'eraId');
  const entry = eraId ? await readEraRow<CodexEntry>({ projectId: resolveProjectId(args), eraId }, 'codexEntries', id) : await getCodexEntry(id);
  if (!entry) throw new BridgeError('not-found', `No codex entry with id "${id}".`);
  return entry;
}

export async function whListCodex(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const type = optEnum(args, 'type', TYPES);
  const eraId = optString(args, 'eraId');
  const entries = eraId ? await listEraRows<CodexEntry>({ projectId, eraId }, 'codexEntries') : await getCodexEntries(projectId);
  const revealedFilter = optBoolean(args, 'revealed');
  const filtered = entries.filter((e) => (!type || e.type === type) && (revealedFilter === undefined || isRevealed(e) === revealedFilter));
  const templates = (await db.projects.get(projectId))?.codexTemplates ?? [];
  return {
    projectId,
    entries: filtered.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      ...projectCodexEntry(entry, templates),
      templateId: entry.templateId,
      tags: entry.tags,
      hasBody: Boolean(entry.content && entry.content.trim()),
      revealed: isRevealed(entry),
      updatedAt: entry.updatedAt,
    })),
  };
}

/**
 * The `aliases` argument, checked like the card's alias chips: a common word,
 * a one-letter name or the card's own name is refused with the reason.
 */
function aliasesArg(args: ToolArgs, title: string): string[] | undefined {
  const aliases = optStringArray(args, 'aliases');
  if (aliases === undefined) return undefined;
  for (const alias of aliases) {
    const problem = aliasProblem(alias, title);
    if (problem) throw new BridgeError('bad-args', `Alias "${alias}" refused: ${problem === 'common' ? 'too common a word, it would link every page' : problem === 'short' ? 'too short to be a name' : 'it is already the card\'s name'}.`);
  }
  return aliases;
}

export async function whGetCodexEntry(args: ToolArgs): Promise<unknown> {
  const entry = await mustGetEntry(requireString(args, 'id'), args);
  assertRowInScope(args, entry.projectId);
  const templates = (await db.projects.get(entry.projectId))?.codexTemplates ?? [];
  return {
    id: entry.id,
    projectId: entry.projectId,
    type: entry.type,
    title: entry.title,
    ...projectCodexEntry(entry, templates),
    storedFields: entry.fields,
    templateId: entry.templateId,
    referenceFields: entry.referenceFields,
    tags: entry.tags,
    aliases: readAliases(entry.fields),
    aliasSuggestions: suggestAliases(entry.title, readAliases(entry.fields), { person: entry.type === 'character' }),
    // Required properties of its type left empty: the app will not save the card until they are filled.
    missingRequired: (() => { const raw = templates.find(item => item.id === entry.templateId); return raw ? missingRequiredProperties(propertyDefinitions(effectiveCodexTemplate(raw, templates)), entry.fields).map(definition => definition.label) : []; })(),
    revealed: isRevealed(entry),
    ...(readReveal(entry.revealed) ? { reveal: readReveal(entry.revealed) } : {}),
    updatedAt: entry.updatedAt,
    content: markdownFromHtml(entry.content),
  };
}

export async function whCreateCodexEntry(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  const title = requireString(args, 'title');
  const type = optEnum(args, 'type', TYPES) ?? 'character';
  const markdown = optString(args, 'content') ?? '';
  const now = Date.now();
  const templateId = optString(args, 'templateId');
  const templates = (await db.projects.get(projectId))?.codexTemplates ?? [];
  const template = templates.find(item => item.id === templateId);
  if (templateId && !template) throw new BridgeError('bad-args', 'Template not found in this project.');
  const aliases = aliasesArg(args, title);
  const fields = aliases ? replaceAliases(optStringMap(args, 'fields') ?? {}, aliases) : optStringMap(args, 'fields') ?? {};
  if (template && effectiveCodexTemplate(template, templates).propertyDefinitions?.some(item => item.formula && Object.hasOwn(fields, item.key))) throw new BridgeError('bad-args', 'Calculated properties cannot be written.');
  const applied = template ? applyCodexTemplate(template, fields, markdown ? htmlFromMarkdown(markdown) : '', templates) : undefined;
  const entry: CodexEntry = {
    id: generateId('codex'),
    projectId,
    type,
    title,
    fields: applied?.fields ?? fields,
    content: applied?.content ?? (markdown ? htmlFromMarkdown(markdown) : ''),
    ...(applied ? { type: applied.type, templateId: applied.templateId } : {}),
    tags: optStringArray(args, 'tags') ?? [],
    relations: [],
    createdAt: now,
    updatedAt: now,
  };
  const eraId = optString(args, 'eraId');
    let libraryCreation;
    if(Object.hasOwn(args,'folderId')||Object.hasOwn(args,'expectedLibraryRevision')){
      if(typeof args.folderId!=='string'||!Number.isSafeInteger(args.expectedLibraryRevision)||Number(args.expectedLibraryRevision)<0)throw new BridgeError('bad-args','Folder creation needs folderId (empty for Unfiled) and the observed expectedLibraryRevision.');
      try{libraryCreation=await createLibraryCodex({projectId,eraId},entry,Number(args.expectedLibraryRevision),args.folderId||undefined);}
      catch(error){if(error instanceof WorkspaceLibraryConflict)throw new BridgeError('conflict','The Library changed. Read wh_workspace_library_get and review the destination before retrying.');if(error instanceof WorkspaceLibraryInvalidAction)throw new BridgeError('bad-args','Choose an existing folder from wh_workspace_library_get.');throw error;}
    }else if (eraId) await saveEraDocument({ projectId, eraId }, 'codex', { root: entry as unknown as EraRow, children: {} }, null); else await createCodexEntry(entry);
  return withAudit(
    { id: entry.id, title: entry.title, type: entry.type, created: true },
      { projectId, entityId: entry.id, summary: `created ${type} "${title}"`, ...(libraryCreation?{before:{__workspaceCodexCreation:libraryCreation}}:{}) },
  );
}

export async function whUpdateCodexEntry(args: ToolArgs): Promise<unknown> {
  const entry = await mustGetEntry(requireString(args, 'id'), args);
  await assertEngineEnabled(entry.projectId, 'codex');
  assertRowInScope(args, entry.projectId);
  const changes: Partial<CodexEntry> = {};

  const incomingFields = optStringMap(args, 'fields');
  if (incomingFields) {
    const projection = projectCodexEntry(entry, (await db.projects.get(entry.projectId))?.codexTemplates ?? []);
    if (Object.keys(incomingFields).some(key => projection.properties[key]?.calculated)) throw new BridgeError('bad-args', 'Calculated properties cannot be written. Change their inputs or template formula.');
    if (optBoolean(args, 'replaceFields') === true) {
      changes.fields = incomingFields;
    } else {
      // Merge, so adding one attribute never wipes the rest of the sheet.
      // An empty string is the explicit "remove this key" signal.
      const merged: Record<string, string> = { ...entry.fields };
      for (const [key, value] of Object.entries(incomingFields)) {
        if (value === '') delete merged[key];
        else merged[key] = value;
      }
      changes.fields = merged;
    }
  }

  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const type = optEnum(args, 'type', TYPES);
  if (type !== undefined) changes.type = type;
  const markdown = optString(args, 'content');
  if (markdown !== undefined) {
    if (!markdown.trim()) throw new BridgeError('bad-args', EMPTY_CONTENT);
    changes.content = htmlFromMarkdown(markdown);
  }
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const aliases = aliasesArg(args, changes.title ?? entry.title);
  if (aliases !== undefined) changes.fields = replaceAliases(changes.fields ?? entry.fields, aliases);
  if (args.freeze !== undefined) {
    if (args.freeze !== true) throw new BridgeError('bad-args', 'freeze is true: to link a card to a type again, use the card form or wh_create_codex_entry templateId.');
    if (!entry.templateId) throw new BridgeError('bad-args', 'This card has no type to freeze it from.');
    const frozen = freezeCodexEntry({ ...entry, ...changes }, (await db.projects.get(entry.projectId))?.codexTemplates ?? []);
    changes.fields = frozen.fields; changes.propertyDefinitions = frozen.propertyDefinitions; changes.templateId = undefined;
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const before: Record<string, unknown> = {
    title: entry.title,
    type: entry.type,
    fields: entry.fields,
    tags: entry.tags,
    ...('templateId' in changes ? { templateId: entry.templateId, propertyDefinitions: entry.propertyDefinitions } : {}),
  };
  // The body is replaced whole and there is no snapshot table behind the codex,
  // so it goes into the log or it is gone.
  if (changes.content !== undefined) before.content = entry.content;
  const eraId = optString(args, 'eraId');
  if (eraId) await saveCodexDraft(entry, { ...entry, ...changes }, { projectId: entry.projectId, eraId }); else await updateCodexEntry(entry.id, changes);
  return withAudit(
    { id: entry.id, updated: Object.keys(changes), fields: changes.fields ?? entry.fields },
    {
      projectId: entry.projectId,
      entityId: entry.id,
      summary: `updated ${entry.type} "${entry.title}" (${Object.keys(changes).join(', ')})`,
      before,
    },
  );
}

export async function whCodexTemplates(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args), project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project not found.');
  const templates = project.codexTemplates ?? [];
  return { projectId, templates, effectiveTemplates: templates.map(template => effectiveCodexTemplate(template, templates)) };
}
export async function whSaveCodexTemplate(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  const supplied = args.template;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new BridgeError('bad-args', 'template is required.');
  const template = supplied as CodexTemplate, now = Date.now();
  const revision = args.expectedRevision;
  if (revision !== null && (typeof revision !== 'number' || !Number.isInteger(revision))) throw new BridgeError('bad-args', 'expectedRevision must be null for creation or the current revision.');
  const draft = { ...template, id: template.id || generateId('codex-template'), revision: 0, createdAt: now, updatedAt: now };
  const saved = await saveCodexTemplate(projectId, draft, revision as number | null);
  return withAudit({ projectId, template: saved }, { projectId, summary: `saved codex template "${saved.name}"` });
}
export async function whDeleteCodexTemplate(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  if (typeof args.expectedRevision !== 'number') throw new BridgeError('bad-args', 'expectedRevision is required.');
  await deleteCodexTemplate(projectId, requireString(args, 'templateId'), args.expectedRevision);
  return { projectId, deleted: true };
}
export async function whPreviewCodexSync(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  return previewTemplateSync(projectId, requireString(args, 'templateId'), { includeSubtypes: optBoolean(args, 'includeSubtypes'), resetFields: optStringArray(args, 'resetFields'), content: optEnum(args, 'content', ['empty', 'keep', 'append', 'replace'] as const) } satisfies TemplateSyncOptions);
}
export async function whApplyCodexSync(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  const preview = args.preview as TemplateSyncPreview;
  if (!preview || preview.projectId !== projectId || !Array.isArray(preview.changes)) throw new BridgeError('bad-args', 'Pass the complete preview returned for this project.');
  return applyTemplateSync(preview);
}

/** Ready-made types for the project's genres: those whose name it lacks, or a dry list. */
export async function whCodexSeedGenreTypes(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project not found.');
  const locale = optEnum(args, 'locale', ['es', 'en'] as const) ?? 'es';
  const genres = optStringArray(args, 'genres') ?? project.genres ?? [];
  if (!genres.length) throw new BridgeError('bad-args', 'The project has no genres; set them with wh_project_genres_set or pass genres.');
  const planned = genrePackTemplates(genres, project.codexTemplates ?? [], locale);
  if (optBoolean(args, 'dryRun') === true) return { projectId, genres, wouldAdd: planned.map(template => ({ name: template.name, category: template.category, icon: template.icon, fields: Object.keys(template.fields) })) };
  const added = await seedGenrePack(projectId, genres, project.codexTemplates ?? [], locale);
  const after = (await db.projects.get(projectId))?.codexTemplates ?? [];
  return withAudit(
    { projectId, genres, added, templates: after.filter(template => added.includes(template.name)).map(template => ({ id: template.id, name: template.name, category: template.category })) },
    { projectId, entityId: projectId, summary: `added ${added.length} genre type(s)`, before: { __seededTemplateIds: after.filter(template => added.includes(template.name)).map(template => template.id) } },
  );
}

/** The guided-card questions, for one kind of card or all of them. */
export async function whCodexGuides(args: ToolArgs): Promise<unknown> {
  const locale = optEnum(args, 'locale', ['es', 'en'] as const) ?? 'es';
  const type = optEnum(args, 'type', TYPES);
  const guides = type ? CARD_GUIDES.filter(guide => guide.type === type) : CARD_GUIDES;
  if (type && !guides.length) throw new BridgeError('not-found', `No guide for "${type}"; guides exist for ${CARD_GUIDES.map(guide => guide.type).join(', ')}.`);
  return { guides: guides.map(guide => ({ type: guide.type, name: guide.name[locale], steps: guide.steps.map(step => ({ field: step.field[locale], question: step.question[locale], hint: step.hint[locale] })) })) };
}

/** A card made from guide answers, as "Ficha guiada" does: each answer fills its field, the first opens the description. */
export async function whCodexGuidedCreate(args: ToolArgs): Promise<unknown> {
  await resolveProjectForEngine(args, 'codex');
  const locale = optEnum(args, 'locale', ['es', 'en'] as const) ?? 'es';
  const type = optEnum(args, 'type', TYPES);
  const guide = type ? cardGuide(type) : undefined;
  if (!guide) throw new BridgeError('bad-args', `type must be one of ${CARD_GUIDES.map(item => item.type).join(', ')}.`);
  const answers = args.answers;
  if (!Array.isArray(answers) || answers.length > guide.steps.length || answers.some(answer => typeof answer !== 'string')) throw new BridgeError('bad-args', `answers is a list of up to ${guide.steps.length} strings, in the order of wh_codex_guides.`);
  const { fields } = guideAnswers(guide, answers as string[], locale);
  const gist = String(answers[0] ?? '').trim();
  const created = await whCreateCodexEntry({ ...(args.projectId ? { projectId: args.projectId } : {}), ...(args.eraId ? { eraId: args.eraId } : {}), type: guide.type, title: requireString(args, 'title'), fields, ...(gist ? { content: gist } : {}) }) as { __audit?: { table?: string } };
  // Undone as the card it creates, in the base or in an era.
  if (created.__audit && !created.__audit.table) created.__audit.table = 'codexEntries';
  return created;
}
