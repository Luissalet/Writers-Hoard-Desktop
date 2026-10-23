import type { WorldFolderDecision, WorldFolderPlan } from '@/services/worldFolderImport/types';

/** The source files the review table lists. */
export const REVIEW_PATH = /\.(md|markdown|csv|json|pdf)$/i;
export interface ReviewGroup { key: string; label: { es: string; en: string }; paths: string[] }

const TARGET_LABEL: Record<string, { es: string; en: string }> = {
  writings: { es: 'Capítulos', en: 'Chapters' },
  tables: { es: 'Tablas', en: 'Tables' },
  timeline: { es: 'Cronologías', en: 'Timelines' },
};
const TYPE_LABEL: Record<string, { es: string; en: string }> = {
  custom: { es: 'otras', en: 'other' }, character: { es: 'personajes', en: 'characters' }, location: { es: 'lugares', en: 'places' },
  item: { es: 'objetos', en: 'items' }, faction: { es: 'facciones', en: 'factions' }, concept: { es: 'conceptos', en: 'concepts' }, magic: { es: 'magia', en: 'magic' },
};

/**
 * The review's files grouped by what they will become: one group per
 * destination (chapters, tables, timelines) and one per Codex category.
 * Files that produced no row (skipped) are not selectable and are left out.
 */
export function reviewGroups(plan: WorldFolderPlan, decisions: Record<string, WorldFolderDecision>): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const file of plan.files) {
    if (!REVIEW_PATH.test(file.path)) continue;
    const rows = plan.rows.filter(row => row.sourcePath === file.path);
    if (!rows.length) continue;
    const decision = decisions[file.path], target = decision?.target ?? rows[0].target;
    const type = decision?.type ?? rows[0].type ?? 'custom';
    const key = target === 'codex' ? `codex:${type}` : target;
    const label = target === 'codex'
      ? { es: `Fichas de Códex · ${TYPE_LABEL[type]?.es ?? type}`, en: `Codex cards · ${TYPE_LABEL[type]?.en ?? type}` }
      : TARGET_LABEL[target] ?? { es: target, en: target };
    const group = groups.get(key) ?? { key, label, paths: [] };
    group.paths.push(file.path);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
