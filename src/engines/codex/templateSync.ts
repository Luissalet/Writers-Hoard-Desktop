import { db } from '@/db';
import { notifyProjectsChanged, updateCodexEntry } from '@/db/operations';
import type { CodexEntry } from '@/types';
import { effectiveCodexTemplate, templateIsWithin } from './templateHierarchy';
import type { CodexTemplate } from './templateTypes';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';

export interface TemplateSyncOptions { includeSubtypes?: boolean; resetFields?: string[]; content?: 'empty' | 'replace' | 'append' | 'keep' }
export interface TemplateSyncChange { id: string; title: string; expectedUpdatedAt: number; fields: Record<string, string>; content: string; added: string[]; reset: string[]; preserved: string[]; bodyChanged: boolean }
export interface TemplateSyncPreview { projectId: string; templateId: string; templateRevisions: Record<string, number>; options: TemplateSyncOptions; changes: TemplateSyncChange[] }
const emptyBody = (html: string) => !html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/g, '') && !/<(?:img|audio|video|iframe|figure|table)\b|data-wh-/i.test(html);
export function planTemplateSync(entries: readonly CodexEntry[], template: CodexTemplate, templates: readonly CodexTemplate[], options: TemplateSyncOptions = {}): TemplateSyncChange[] {
  return entries.filter(entry => entry.templateId === template.id || options.includeSubtypes && templateIsWithin(entry.templateId, template.id, templates)).map(entry => {
    const own = templates.find(item => item.id === entry.templateId) ?? template, effective = effectiveCodexTemplate(own, templates);
    const fields = { ...entry.fields }, added: string[] = [], reset: string[] = [], preserved: string[] = [];
    for (const [key, value] of Object.entries(effective.fields)) {
      if (effective.propertyDefinitions?.some(item => item.key === key && item.formula)) continue;
      if (!Object.hasOwn(fields, key)) { fields[key] = value; added.push(key); }
      else if (options.resetFields?.includes(key)) { fields[key] = value; if (entry.fields[key] !== value) reset.push(key); }
      else if (fields[key] !== value) preserved.push(key);
    }
    const mode = options.content ?? 'empty';
    const content = mode === 'replace' ? effective.content : mode === 'append' ? entry.content + effective.content : mode === 'empty' && emptyBody(entry.content) ? effective.content : entry.content;
    return { id: entry.id, title: entry.title, expectedUpdatedAt: entry.updatedAt, fields, content, added, reset, preserved, bodyChanged: content !== entry.content };
  });
}
export async function previewTemplateSync(projectId: string, templateId: string, options: TemplateSyncOptions = {}): Promise<TemplateSyncPreview> {
  const project = await db.projects.get(projectId), templates = project?.codexTemplates ?? [], template = templates.find(item => item.id === templateId);
  if (!template) throw new Error('template_missing');
  return { projectId, templateId, options: structuredClone(options), templateRevisions: Object.fromEntries(templates.map(item => [item.id, item.revision])), changes: planTemplateSync(await db.codexEntries.where('projectId').equals(projectId).toArray(), template, templates, options) };
}
/** Recompute the approved plan against current data inside the write transaction. */
export async function applyTemplateSync(preview: TemplateSyncPreview): Promise<{ updated: number; preserved: number }> {
  const result = await db.transaction('rw', [db.projects, db.codexEntries, db.relationships, db.characterArcs], async () => {
    const current = await previewTemplateSync(preview.projectId, preview.templateId, preview.options);
    if (JSON.stringify(current.templateRevisions) !== JSON.stringify(preview.templateRevisions) || JSON.stringify(current.changes) !== JSON.stringify(preview.changes)) throw new Error('template_sync_conflict');
    let updated = 0;
    for (const change of current.changes) if (change.added.length || change.reset.length || change.bodyChanged) { await updateCodexEntry(change.id, { fields: change.fields, content: change.content }); updated++; }
    return { updated, preserved: current.changes.reduce((sum, change) => sum + change.preserved.length, 0) };
  });
  notifyProjectsChanged(); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId: preview.projectId }); return result;
}
