import type { CodexEntry } from '@/types';
import { isAliasField } from '@/services/codexReference/aliases';
import { stripHtml } from '@/utils/text';
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
export function codexBlockPreview(entry: CodexEntry) {
  const text = stripHtml(entry.content);
  return { title: entry.title.slice(0, 300), avatar: localAvatar(entry.avatar), fields: Object.entries(entry.fields).filter(([key, value]) => !isAliasField(key) && typeof value === 'string' && value.trim()).slice(0, 5).map(([key, value]) => [key.slice(0, 80), value.slice(0, 200)] as const), text: text.slice(0, 600), truncated: text.length > 600 };
}
