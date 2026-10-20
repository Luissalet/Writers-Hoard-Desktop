import type { CodexEntry, CodexEntryType } from '@/types';
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { foldAlias } from '@/services/codexReference/aliases';
import { effectiveCodexTemplate, validateTemplateHierarchy } from './templateHierarchy';

import type { CodexTemplate } from './templateTypes';
export type { CodexTemplate, ReferenceFieldDefinition } from './templateTypes';
export class CodexTemplateConflict extends Error {
  constructor() { super('template_conflict'); this.name = 'CodexTemplateConflict'; }
}
export function templateFromEntry(entry: CodexEntry, id: string, name: string, now: number): CodexTemplate {
  return { id, name, category: entry.type, fields: { ...entry.fields }, content: entry.content, referenceFieldDefinitions: Object.keys(entry.referenceFields ?? {}).map(key => ({ key, label: key })), revision: 0, createdAt: now, updatedAt: now };
}
export function applyCodexTemplate(template: CodexTemplate, fields: Record<string, string>, content: string, templates: readonly CodexTemplate[] = []): { type: CodexEntryType; templateId: string; fields: Record<string, string>; content: string } {
  if (templates.length) template = effectiveCodexTemplate(template, templates);
  return { type: template.category, templateId: template.id, fields: { ...template.fields, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim())) }, content: content.trim() ? content : template.content };
}
export async function saveCodexTemplate(projectId: string, draft: CodexTemplate, expectedRevision: number | null): Promise<CodexTemplate> {
  if (!draft.name.trim()) throw new Error('template_name_required');
  if (!['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'].includes(draft.category) || !draft.fields || Object.values(draft.fields).some(value => typeof value !== 'string') || typeof draft.content !== 'string') throw new Error('template_invalid');
  const names = new Set<string>();
  for (const key of Object.keys(draft.fields)) { if (!key.trim() || names.has(foldAlias(key))) throw new Error('template_field_collision'); names.add(foldAlias(key)); }
  for (const definition of draft.referenceFieldDefinitions ?? []) {
    const key = definition.key.trim();
    if (!key || !definition.label.trim() || names.has(foldAlias(key))) throw new Error('template_field_collision');
    names.add(foldAlias(key));
  }
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
    const templates = project.codexTemplates ?? [];
    const current = templates.find(template => template.id === draft.id);
    if (expectedRevision === null ? !!current : current?.revision !== expectedRevision) throw new CodexTemplateConflict();
    validateTemplateHierarchy(draft, templates);
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
    const next = structuredClone({ ...draft, name: draft.name.trim(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? draft.createdAt, updatedAt: now });
    await db.projects.update(projectId, { codexTemplates: current ? templates.map(template => template.id === draft.id ? next : template) : [...templates, next], updatedAt: Math.max(now, project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}
/** Existing cards retain their values and template provenance when a template is retired. */
export async function deleteCodexTemplate(projectId: string, id: string, revision: number): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
    const current = project.codexTemplates?.find(template => template.id === id);
    if (current?.revision !== revision) throw new CodexTemplateConflict();
    const templates = project.codexTemplates!, now = Math.max(Date.now(), project.updatedAt + 1);
    const next = templates.filter(template => template.id !== id).map(template => {
      const child = template.parentTemplateId === id;
      // Fold only the retiring layer into direct children. Grandparent defaults
      // stay inherited, so future ancestor edits still flow to new cards.
      const resolved = child ? effectiveCodexTemplate(template, [{ ...current, parentTemplateId: undefined }, template]) : template;
      const definitions = resolved.referenceFieldDefinitions?.map(definition => definition.targetTemplateId === id ? { ...definition, targetTemplateId: current.parentTemplateId, targetType: definition.targetType ?? current.category } : definition);
      const changedReference = definitions?.some((definition, index) => definition !== resolved.referenceFieldDefinitions?.[index]);
      if (!child && !changedReference) return template;
      const ownBody = [template, current].some(item => item.contentMode === 'replace' || item.contentMode !== 'inherit' && Boolean(item.content.trim()));
      return { ...resolved, ...(child ? { parentTemplateId: current.parentTemplateId, contentMode: ownBody ? 'replace' as const : 'inherit' as const } : {}), referenceFieldDefinitions: definitions, revision: template.revision + 1, updatedAt: Math.max(now, template.updatedAt + 1) };
    });
    await db.projects.update(projectId, { codexTemplates: next, updatedAt: now });
  });
  notifyProjectsChanged();
}
