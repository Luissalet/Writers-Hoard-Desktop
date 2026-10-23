import type { CodexEntry } from '@/types';
import { isAliasField } from '@/services/codexReference/aliases';
import { stripHtml } from '@/utils/text';
import { codexPropertyHtml, projectCodexEntry } from '@/engines/codex/properties';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
export const CODEX_BLOCK_NAME = 'codexLiveBlock';
export interface CodexBlockContext { projectId?: string; scopeId?: string }
export interface CodexBlockTarget { projectId: string; entryId: string; label: string }
export interface CodexBlockHost { context: () => CodexBlockContext; subscribe?: (listener: () => void) => () => void }
export function createCodexBlockHost(initial: CodexBlockContext) {
  let current = initial; const listeners = new Set<() => void>();
  return { context: () => current, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, setContext: (next: CodexBlockContext) => {
    if (next.projectId === current.projectId && next.scopeId === current.scopeId) return;
    current = next; for (const listener of listeners) listener();
  } };
}
export function blockIdentifier(value: unknown): string { return typeof value === 'string' && value.length <= 500 && !Array.from(value).some(character => character.charCodeAt(0) < 32) ? value : ''; }
export function blockLabel(value: unknown): string { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : ''; }
export function blockMatchesProject(target: Pick<CodexBlockTarget, 'projectId' | 'entryId'>, context: CodexBlockContext): boolean { return Boolean(target.entryId && context.projectId && target.projectId === context.projectId); }
export function localAvatar(value: string | undefined): string | undefined { return value && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(value) ? value : undefined; }
/** Projection only. Live prose/fields are never written back into node attrs. */
export function codexBlockPreview(entry: CodexEntry, templates: readonly CodexTemplate[] = [], excludedFields?: ReadonlySet<string>) {
  const text = stripHtml(entry.content);
  const projection = projectCodexEntry(entry, [...templates]);
  const visibleFields = Object.entries(projection.fields).filter(([key, value]) => !isAliasField(key) && !excludedFields?.has(key) && typeof value === 'string' && value.trim()).slice(0, 5);
  const fieldHtml = Object.fromEntries(visibleFields.filter(([key]) => { const property = projection.properties[key]; return property?.options || property?.displayValue !== undefined && property.displayValue !== property.value; }).map(([key]) => { const property = projection.properties[key]; return [property.label.slice(0, 80), codexPropertyHtml({ ...property, value: property.value.slice(0, 200), displayValue: property.displayValue?.slice(0, 200), options: property.options?.slice(0, 12).map(option => ({ ...option, value: option.value.slice(0, 200) })) })]; }));
  return { title: entry.title.slice(0, 300), avatar: localAvatar(entry.avatar), fields: visibleFields.map(([key, value]) => [(projection.properties[key]?.label ?? key).slice(0, 80), value.slice(0, 200)] as const), fieldHtml, text: text.slice(0, 600), truncated: text.length > 600 };
}
