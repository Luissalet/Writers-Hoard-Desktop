import { normalizeAdvancedFormatting, type AdvancedFormatting } from '../advanced/model';

export interface EditorialScope { from: number; to: number }
export interface EditorialResult { ok: boolean; changed: boolean; reason?: string }
export interface NamedEditorialStyle {
  id: string; name: string; format: AdvancedFormatting;
  bold?: boolean; italic?: boolean; underline?: boolean; headingLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}
/** All page measurements are points, matching the native document model. */
export interface EditorialSection {
  id: string; start: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage';
  pageWidth: number; pageHeight: number;
  marginTop: number; marginRight: number; marginBottom: number; marginLeft: number;
  header: string; footer: string;
}
export interface EditorialReference {
  id: string; title: string; authors?: string[]; publisher?: string; publishedAt?: string;
  url?: string; updatedAt?: number; retractedAt?: number;
}
export interface EditorialCitation {
  id: string; sourceId: string; label: string; locator?: string; evidenceId?: string;
  title?: string; authors?: string[]; publisher?: string; publishedAt?: string; url?: string;
  snapshotUpdatedAt?: number; snapshotRetractedAt?: number;
}
export interface EditorialReferenceNotice { citationId: string; sourceId: string; kind: 'missing' | 'changed' | 'retracted' }
export const EDITORIAL_ATTRIBUTES = {
  styleDefinition: 'data-wh-editorial-style', styleId: 'data-wh-style-id',
  section: 'data-wh-section', citation: 'data-wh-citation', bibliography: 'data-wh-bibliography',
} as const;
export const DEFAULT_EDITORIAL_SECTION: Omit<EditorialSection, 'id'> = {
  start: 'continuous', pageWidth: 595.2756, pageHeight: 841.8898,
  marginTop: 72, marginRight: 72, marginBottom: 72, marginLeft: 72, header: '', footer: '',
};
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function normalizeEditorialStyle(value: unknown): NamedEditorialStyle | null {
  const v = record(value); if (!v || typeof v.id !== 'string' || !v.id || typeof v.name !== 'string' || !v.name.trim()) return null;
  const result: NamedEditorialStyle = { id: v.id, name: v.name, format: normalizeAdvancedFormatting(v.format) };
  for (const key of ['bold', 'italic', 'underline'] as const) if (typeof v[key] === 'boolean') result[key] = v[key];
  if (Number.isInteger(v.headingLevel) && Number(v.headingLevel) >= 0 && Number(v.headingLevel) <= 6) result.headingLevel = v.headingLevel as NamedEditorialStyle['headingLevel'];
  return result;
}
export function normalizeEditorialSection(value: unknown): EditorialSection | null {
  const v = record(value); if (!v || typeof v.id !== 'string' || !v.id) return null;
  const keys = ['pageWidth', 'pageHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
  if (keys.some(key => !finite(v[key]) || Number(v[key]) < 0) || Number(v.pageWidth) <= 0 || Number(v.pageHeight) <= 0) return null;
  if (Number(v.marginLeft) + Number(v.marginRight) >= Number(v.pageWidth) || Number(v.marginTop) + Number(v.marginBottom) >= Number(v.pageHeight)) return null;
  if (!['continuous', 'nextPage', 'evenPage', 'oddPage'].includes(String(v.start)) || typeof v.header !== 'string' || typeof v.footer !== 'string') return null;
  return { id: v.id, start: v.start as EditorialSection['start'], pageWidth: Number(v.pageWidth), pageHeight: Number(v.pageHeight), marginTop: Number(v.marginTop), marginRight: Number(v.marginRight), marginBottom: Number(v.marginBottom), marginLeft: Number(v.marginLeft), header: v.header, footer: v.footer };
}
export function normalizeEditorialCitation(value: unknown): EditorialCitation | null {
  const v = record(value); if (!v || typeof v.id !== 'string' || !v.id || typeof v.sourceId !== 'string' || !v.sourceId || typeof v.label !== 'string') return null;
  const result: EditorialCitation = { id: v.id, sourceId: v.sourceId, label: v.label };
  for (const key of ['locator', 'evidenceId', 'title', 'publisher', 'publishedAt', 'url'] as const) if (typeof v[key] === 'string') result[key] = v[key];
  if (Array.isArray(v.authors) && v.authors.every(item => typeof item === 'string')) result.authors = [...v.authors];
  for (const key of ['snapshotUpdatedAt', 'snapshotRetractedAt'] as const) if (finite(v[key])) result[key] = v[key];
  return result;
}
export function parseEditorialAttribute<T>(element: Element, attribute: string, normalize: (value: unknown) => T | null): T | null {
  try { return normalize(JSON.parse(element.getAttribute(attribute) ?? 'null')); } catch { return null; }
}
/** JSON stays literal data through HTML sanitizers, including their XML closing-tag checks. */
export function serializeEditorialMetadata(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
export function citationFromReference(reference: EditorialReference, input: Pick<EditorialCitation, 'id' | 'label'> & Partial<Pick<EditorialCitation, 'locator' | 'evidenceId'>>): EditorialCitation {
  return normalizeEditorialCitation({ ...input, sourceId: reference.id, title: reference.title, authors: reference.authors, publisher: reference.publisher, publishedAt: reference.publishedAt, url: reference.url, snapshotUpdatedAt: reference.updatedAt, snapshotRetractedAt: reference.retractedAt })!;
}
export function editorialReferenceNotices(citations: readonly EditorialCitation[], references: readonly EditorialReference[]): EditorialReferenceNotice[] {
  const sources = new Map(references.map(reference => [reference.id, reference]));
  return citations.flatMap(citation => {
    const reference = sources.get(citation.sourceId); const notices: EditorialReferenceNotice[] = [];
    if (!reference) notices.push({ citationId: citation.id, sourceId: citation.sourceId, kind: 'missing' });
    else {
      if (reference.retractedAt !== undefined) notices.push({ citationId: citation.id, sourceId: citation.sourceId, kind: 'retracted' });
      if (reference.updatedAt !== undefined && reference.updatedAt !== citation.snapshotUpdatedAt) notices.push({ citationId: citation.id, sourceId: citation.sourceId, kind: 'changed' });
    }
    return notices;
  });
}
/** Plain source list, not an unimplemented CSL or APA formatter. */
export function editorialBibliographyText(citations: readonly EditorialCitation[], references?: readonly EditorialReference[]): string[] {
  const seen = new Set<string>(); const sources = references ? new Map(references.map(reference => [reference.id, reference])) : undefined;
  return citations.filter(citation => { if (seen.has(citation.sourceId)) return false; seen.add(citation.sourceId); return true; }).map(citation => {
    const source = sources?.get(citation.sourceId) ?? citation;
    return [source.authors?.join(', '), source.title || citation.label, source.publishedAt, source.publisher, source.url].filter(Boolean).join('. ');
  });
}
