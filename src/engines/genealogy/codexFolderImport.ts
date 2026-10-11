import type { CodexEntry, CodexEntryType } from '@/types';

export const CODEX_IMPORT_FORMATS = ['obsidian', 'notion', 'worldanvil', 'campfire'] as const;
export type CodexImportFormat = typeof CODEX_IMPORT_FORMATS[number];
export interface CodexFolderInput { format: CodexImportFormat; files: { path: string; text: string }[] }
export interface CodexImportIssue { index: number; path?: string; code: string; message: string }
export interface CodexImportDocument {
  path: string; title: string; type: CodexEntryType; body: string;
  sourceText: string; explicitId?: string; fields: Record<string, string>; tags: string[];
}
export interface CodexFolderPreview {
  additions: (CodexImportDocument & { id: string })[];
  duplicates: { path: string; id: string }[];
  conflicts: { path: string; id: string; reason: string }[];
  issues: CodexImportIssue[];
}

const sourcePath = '__importSourcePath';
const sourceFormat = '__importSourceFormat';
const sourceContent = '__importSourceContent';
const sourceId = '__importSourceId';
const types = new Set(['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom']);
const aliases: Record<string, CodexEntryType> = { person: 'character', character: 'character', personaje: 'character', place: 'location', location: 'location', lugar: 'location', item: 'item', object: 'item', objeto: 'item', faction: 'faction', organization: 'faction', 'facción': 'faction', 'organización': 'faction', concept: 'concept', concepto: 'concept', magic: 'magic', magia: 'magic', custom: 'custom', note: 'custom' };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textOf = (value: unknown): string => typeof value === 'string' ? value : '';

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '').replace(/\/+/g, '/').trim();
}
function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { const decoded: unknown = JSON.parse(trimmed); if (typeof decoded === 'string') return decoded; } catch { /* Preserve a YAML scalar without evaluating it. */ }
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}
function tagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  return value.replace(/^\[|\]$/g, '').split(',').map(scalar).filter(Boolean);
}

function documentFrom(meta: Record<string, unknown>, body: string, path: string, sourceText: string, declaredType?: string): CodexImportDocument {
  const declared = textOf(meta.type ?? meta.entryType ?? meta.entry_type ?? meta.category ?? meta.template ?? declaredType).toLowerCase();
  const type = types.has(declared) ? declared as CodexEntryType : aliases[declared] ?? 'custom';
  const fields: Record<string, string> = {};
  if (object(meta.fields)) for (const [key, value] of Object.entries(meta.fields)) if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[key] = String(value);
  if (Array.isArray(meta.aliases)) fields.aliases = JSON.stringify(meta.aliases);
  if (!declared || declared === 'note' || !aliases[declared]) fields.importType = declared || 'note';
  // Preserve explicit scalar export metadata; relationships are never inferred.
  for (const [key, value] of Object.entries(meta)) {
    if (['id', 'title', 'name', 'type', 'entryType', 'category', 'content', 'body', 'description', 'tags', 'fields'].includes(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[key] = String(value);
  }
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const title = textOf(meta.title ?? meta.name).trim() || heading || path.split('/').at(-1)?.replace(/\.(md|markdown|json)$/i, '') || 'Imported note';
  return { path, title, type, body, sourceText, explicitId: textOf(meta.id) || undefined, fields, tags: tagList(meta.tags) };
}

/** Parse uploaded text only: no file access, no writes, no genealogy inference. */
export function parseCodexFolder(input: CodexFolderInput): { documents: CodexImportDocument[]; issues: CodexImportIssue[] } {
  const documents: CodexImportDocument[] = [];
  const issues: CodexImportIssue[] = [];
  if (!CODEX_IMPORT_FORMATS.includes(input?.format)) return { documents, issues: [{ index: -1, code: 'invalid_format', message: 'Unsupported export format.' }] };
  if (!Array.isArray(input?.files) || input.files.length === 0) return { documents, issues: [{ index: -1, code: 'empty_files', message: 'No files supplied.' }] };
  const counts = new Map<string, number>();
  for (const file of input.files) if (typeof file?.path === 'string') {
    const path = normalizedPath(file.path); counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  input.files.forEach((file, index) => {
    const path = typeof file?.path === 'string' ? normalizedPath(file.path) : '';
    const issue = (code: string, message: string) => issues.push({ index, path: path || undefined, code, message });
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || path.includes('\u0000') || typeof file?.text !== 'string') { issue('invalid_file', 'Each file needs a relative path and text.'); return; }
    if ((counts.get(path) ?? 0) > 1) { issue('repeated_path', 'Repeated file path: none of its copies will be applied.'); return; }
    if (!file.text.trim()) { issue('empty_file', 'The file is empty.'); return; }
    if (!/\.(md|markdown|json)$/i.test(path)) { issue('unsupported_file', 'Use Markdown or JSON export files.'); return; }
    try {
      if (/\.json$/i.test(path)) {
        const parsed: unknown = JSON.parse(file.text);
        if (!object(parsed)) throw new Error('Expected a JSON document or collection object.');
        const collections: [string, string | undefined][] = [['characters', 'character'], ['locations', 'location'], ['items', 'item'], ['factions', 'faction'], ['concepts', 'concept'], ['magic', 'magic'], ['documents', undefined], ['articles', undefined]];
        const groups = collections.filter(([key]) => Array.isArray(parsed[key]));
        if (groups.length) {
          const seen = new Set<string>();
          for (const [key, declaredType] of groups) {
            const rows = parsed[key] as unknown[];
            rows.forEach((row, ordinal) => {
              if (!object(row)) { issue('invalid_document', `${key}[${ordinal}] is not a document.`); return; }
              const explicit = textOf(row.id);
              const childPath = `${path}#${key}/${explicit ? encodeURIComponent(explicit) : ordinal}`;
              if (seen.has(childPath)) { issue('repeated_document', `Repeated document id in ${key}.`); return; }
              seen.add(childPath);
              const rawBody = row.content ?? row.body ?? row.description;
              if (rawBody !== undefined && typeof rawBody !== 'string') issue('unmodeled_fields', `${key}[${ordinal}]: nested/non-text body is kept in source JSON, not converted to codex rich text.`);
              const body = textOf(rawBody);
              if (!body.trim() && !textOf(row.title ?? row.name).trim()) { issue('empty_document', `${key}[${ordinal}] is empty.`); return; }
              documents.push(documentFrom(row, body, childPath, JSON.stringify(row), declaredType));
            });
          }
          if (groups.every(([key]) => (parsed[key] as unknown[]).length === 0)) issue('empty_collection', 'The JSON collections are empty.');
        } else {
          const rawBody = parsed.content ?? parsed.body ?? parsed.description;
          if (rawBody !== undefined && typeof rawBody !== 'string') issue('unmodeled_fields', 'Nested/non-text body is kept in source JSON, not converted to codex rich text.');
          const body = textOf(rawBody);
          if (!body.trim() && !textOf(parsed.title ?? parsed.name).trim()) throw new Error('The JSON object contains no document title or body.');
          documents.push(documentFrom(parsed, body, path, file.text));
        }
        return;
      }
      const content = file.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      let body = content;
      const meta: Record<string, unknown> = {};
      if (content.startsWith('---\n')) {
        const end = content.indexOf('\n---', 4);
        if (end < 0 || !/^\n---(?:\n|$)/.test(content.slice(end))) throw new Error('Unclosed Markdown frontmatter.');
        let currentKey = '';
        let unmodeled = false;
        for (const line of content.slice(4, end).split('\n')) {
          if (!line.trim() || line.trim().startsWith('#')) continue;
          if (/^\s+-\s+/.test(line) && (currentKey === 'tags' || currentKey === 'aliases')) {
            const list = Array.isArray(meta[currentKey]) ? meta[currentKey] as string[] : [];
            list.push(scalar(line.replace(/^\s+-\s+/, ''))); meta[currentKey] = list; continue;
          }
          if (/^\s/.test(line)) { unmodeled = true; continue; }
          const pair = /^([\w-]+):\s*(.*)$/.exec(line);
          if (!pair) { unmodeled = true; continue; }
          if (Object.hasOwn(meta, pair[1])) throw new Error(`Repeated frontmatter key: ${pair[1]}.`);
          currentKey = pair[1];
          if ((currentKey === 'tags' || currentKey === 'aliases') && !pair[2].trim()) meta[currentKey] = [];
          else if (currentKey === 'tags' || currentKey === 'aliases') meta[currentKey] = tagList(pair[2]);
          else {
            if (!pair[2].trim() || /^[{[]/.test(pair[2].trim()) || /^[|>]$/.test(pair[2].trim())) unmodeled = true;
            meta[currentKey] = scalar(pair[2]);
          }
        }
        if (unmodeled) issue('unmodeled_fields', 'Nested/complex frontmatter is preserved in the complete source text; only scalar fields, tags and aliases are modeled.');
        body = content.slice(end + 4).replace(/^\n/, '');
      } else if (input.format === 'notion') {
        // Notion Markdown exports print database properties below the title
        // instead of YAML. Read only explicit property names; keep these lines
        // in the body and the original source, without deriving relationships.
        const lines = content.split('\n');
        const heading = lines.findIndex(line => /^#\s/.test(line));
        if (heading >= 0) for (const line of lines.slice(heading + 1)) {
          if (!line.trim()) continue;
          const property = /^(ID|Title|Name|Type|Entry Type|Category|Tags|Aliases):\s*(.*)$/i.exec(line);
          if (!property) break;
          const key = property[1].toLowerCase().replace('entry type', 'entryType');
          meta[key] = key === 'tags' || key === 'aliases' ? tagList(property[2]) : scalar(property[2]);
        }
      }
      if (!body.trim() && !textOf(meta.title ?? meta.name).trim()) { issue('empty_document', 'No document title or body.'); return; }
      documents.push(documentFrom(meta, body, path, file.text));
    } catch (error) { issue('malformed_file', error instanceof Error ? error.message : String(error)); }
  });
  return { documents, issues };
}

export function codexImportId(projectId: string, format: CodexImportFormat, path: string): string {
  return `codex-import:${encodeURIComponent(projectId)}:${format}:${encodeURIComponent(path)}`;
}

export function previewCodexFolderImport(projectId: string, input: CodexFolderInput, existing: readonly CodexEntry[]): CodexFolderPreview {
  const parsed = parseCodexFolder(input);
  const preview: CodexFolderPreview = { additions: [], duplicates: [], conflicts: [], issues: parsed.issues };
  for (const document of parsed.documents) {
    const id = codexImportId(projectId, input.format, document.path);
    const previous = existing.find(entry => entry.id === id || (entry.projectId === projectId && entry.fields[sourcePath] === document.path && entry.fields[sourceFormat] === input.format));
    if (!previous) preview.additions.push({ ...document, id });
    else if (previous.projectId === projectId && previous.fields[sourcePath] === document.path && previous.fields[sourceFormat] === input.format && previous.fields[sourceContent] === document.sourceText) preview.duplicates.push({ path: document.path, id: previous.id });
    else preview.conflicts.push({ path: document.path, id: previous.id, reason: 'source_changed_or_id_occupied' });
  }
  return preview;
}

export interface CodexImportStore {
  list(projectId: string): Promise<CodexEntry[]>;
  get(id: string): Promise<CodexEntry | undefined>;
  addAll(rows: CodexEntry[]): Promise<unknown>;
  deleteAll(ids: string[]): Promise<unknown>;
  atomic<T>(run: () => Promise<T>): Promise<T>;
}
export class CodexImportError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'CodexImportError'; this.code = code; }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

/** Receipts live for this session; transaction ownership stays with the real DB. */
export function createCodexFolderImporter(store: CodexImportStore, htmlFromMarkdown: (body: string) => string) {
  const receipts = new Map<string, { projectId: string; snapshots: CodexEntry[] }>();
  return {
    async preview(projectId: string, input: CodexFolderInput) {
      return previewCodexFolderImport(projectId, input, await store.list(projectId));
    },
    async apply(projectId: string, input: CodexFolderInput) {
      const result = await store.atomic(async () => {
        const preview = previewCodexFolderImport(projectId, input, await store.list(projectId));
        const now = Date.now();
        const rows: CodexEntry[] = preview.additions.map(document => ({
          id: document.id, projectId, type: document.type, title: document.title,
          content: htmlFromMarkdown(document.body), tags: document.tags, relations: [],
          fields: { ...document.fields, [sourcePath]: document.path, [sourceFormat]: input.format, [sourceContent]: document.sourceText, ...(document.explicitId ? { [sourceId]: document.explicitId } : {}) },
          createdAt: now, updatedAt: now,
        }));
        if (rows.length) await store.addAll(rows);
        return { preview, rows };
      });
      const applyId = `codex-import-${crypto.randomUUID()}`;
      receipts.set(applyId, { projectId, snapshots: structuredClone(result.rows) });
      return { ok: true as const, applyId, createdIds: result.rows.map(row => row.id), preview: result.preview, undoPersistence: 'session' as const };
    },
    async undo(projectId: string, applyId: string) {
      const receipt = receipts.get(applyId);
      if (!receipt) throw new CodexImportError('unknown_import', 'The import receipt is unavailable; receipts last for this session.');
      if (receipt.projectId !== projectId) throw new CodexImportError('project_mismatch', 'The import belongs to another project.');
      const removedIds = await store.atomic(async () => {
        for (const snapshot of receipt.snapshots) {
          const current = await store.get(snapshot.id);
          if (!current || canonical(current) !== canonical(snapshot)) throw new CodexImportError('stale_import', 'An imported entry changed after import; no entries were removed.');
        }
        const ids = receipt.snapshots.map(row => row.id);
        if (ids.length) await store.deleteAll(ids);
        return ids;
      });
      receipts.delete(applyId);
      return { ok: true as const, removedIds };
    },
  };
}
