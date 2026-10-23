// What the prep blocks do beyond the page: draw a handout into the gallery
// (and redraw it when its text is edited), and turn an encounter block into a
// fight in the encounter tracker.
import { db } from '@/db';
import type { CodexEntry, InspirationImage } from '@/types';
import { compendiumEntry, searchCompendium, type SrdMonster } from '@/engines/compendium/srd';
import { createCombatant, createEncounter, nextName, type Combatant, type Encounter } from '@/engines/encounters/model';
import { combatantFromMonster } from '@/engines/encounters/fromSources';
import { saveEncounter } from '@/engines/encounters/operations';
import { handoutPlainText, normalizeHandoutDefinition, renderHandoutPng, HANDOUT_TEMPLATE_NAMES, type HandoutDefinition } from './handouts';
import { type EncounterData, type EncounterRow } from './model';

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/** A handout row for the gallery: the picture, a small copy and the text it is drawn from. */
async function handoutRow(projectId: string, id: string, definition: HandoutDefinition, createdAt: number, notes?: string): Promise<InspirationImage> {
  const [full, small] = await Promise.all([renderHandoutPng(definition, 1), renderHandoutPng(definition, 0.4)]);
  const names = HANDOUT_TEMPLATE_NAMES[definition.template][definition.lang];
  return { id, projectId, name: `${names}: ${definition.title || (definition.lang === 'en' ? 'untitled' : 'sin título')}`.slice(0, 160), imageData: full.dataUrl, thumbnailData: small.dataUrl, tags: ['handout', definition.template], notes: notes ?? handoutPlainText(definition).slice(0, 600), createdAt, handout: definition };
}

/** Draw a handout and keep it in the project's gallery; with `existingId` the same picture is redrawn from the edited text, so blocks that point at it stay valid. */
export async function saveHandout(projectId: string, rawDefinition: unknown, existingId?: string): Promise<InspirationImage> {
  const definition = normalizeHandoutDefinition(rawDefinition);
  if (!definition.body.trim() && !definition.title.trim()) throw new Error('handout_empty');
  if (!await db.projects.get(projectId)) throw new Error('project_missing');
  if (existingId) {
    const current = await db.inspirationImages.get(existingId);
    if (!current || current.projectId !== projectId || !current.handout) throw new Error('handout_missing');
    const row = await handoutRow(projectId, existingId, definition, current.createdAt, current.notes === handoutPlainText(current.handout).slice(0, 600) ? undefined : current.notes);
    await db.inspirationImages.put({ ...current, ...row, collectionId: current.collectionId, linkedEntryIds: current.linkedEntryIds });
    return (await db.inspirationImages.get(existingId))!;
  }
  const row = await handoutRow(projectId, crypto.randomUUID(), definition, Date.now());
  await db.inspirationImages.add(row);
  return row;
}

export async function listHandouts(projectId: string): Promise<InspirationImage[]> {
  return (await db.inspirationImages.where('projectId').equals(projectId).toArray()).filter(row => !!row.handout).sort((a, b) => b.createdAt - a.createdAt);
}

export interface PreparedEncounter { encounter: Encounter; combatants: number; unlinked: string[] }

async function combatantsFor(projectId: string, row: EncounterRow, encounter: Encounter): Promise<{ combatant: Combatant; linked: boolean }> {
  if (row.link?.kind === 'monster') {
    const found = await compendiumEntry('monster', row.link.id);
    if (found?.kind === 'monster') return { combatant: combatantFromMonster(found.entry, encounter), linked: true };
  }
  if (row.link?.kind === 'card') {
    const card: CodexEntry | undefined = await db.codexEntries.get(row.link.id);
    if (card && card.projectId === projectId) return { combatant: createCombatant({ name: nextName(encounter, card.title || row.name), player: false, source: { kind: 'card', id: card.id } }), linked: true };
  }
  if (!row.link) {
    // A name that is exactly an SRD creature is seeded with its stats.
    const { hits } = await searchCompendium(row.name, { kind: 'monster' }, 8);
    const exact = hits.find(hit => fold(hit.name) === fold(row.name));
    if (exact) {
      const found = await compendiumEntry('monster', exact.id);
      if (found?.kind === 'monster') return { combatant: combatantFromMonster(found.entry as SrdMonster, encounter), linked: true };
    }
  }
  return { combatant: createCombatant({ name: nextName(encounter, row.name), player: false }), linked: false };
}

/** A new fight in the encounter tracker with one combatant per creature of the block (named "Goblin", "Goblin 2"…). */
export async function prepareEncounter(projectId: string, data: EncounterData, fallbackTitle: string): Promise<PreparedEncounter> {
  if (!data.rows.length) throw new Error('encounter_block_empty');
  if (!await db.projects.get(projectId)) throw new Error('project_missing');
  let encounter = createEncounter(data.title || fallbackTitle);
  const unlinked: string[] = [];
  for (const row of data.rows) {
    let linkedAll = true;
    for (let index = 0; index < row.count; index++) {
      const { combatant, linked } = await combatantsFor(projectId, row, encounter);
      linkedAll &&= linked;
      encounter = { ...encounter, combatants: [...encounter.combatants, combatant] };
    }
    if (!linkedAll) unlinked.push(row.name);
    encounter = { ...encounter, log: [...encounter.log, `+ ${row.count > 1 ? `${row.count}× ` : ''}${row.name}`] };
  }
  const saved = await saveEncounter(projectId, encounter, null);
  return { encounter: saved, combatants: saved.combatants.length, unlinked };
}
