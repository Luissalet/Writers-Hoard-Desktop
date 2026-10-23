// "Crear ficha": a generated idea becomes a Codex card of the matching type —
// a person a character, an inn, shop or village a place, a noble house a
// faction — with each part as a property and the brief as its first line.
import type { CodexEntry, CodexEntryType } from '@/types';
import { createCodexEntry } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { STYLE_TABLES } from './tables';
import { KIND_STEPS, type NameKind } from './types';
import { KIND_LABELS, STEP_LABELS, type NameIdea, type NameLocale } from './generate';

export const KIND_CARD_TYPE: Record<NameKind, CodexEntryType> = { inn: 'location', shop: 'location', village: 'location', person: 'character', house: 'faction' };
const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

export function ideaCard(idea: NameIdea, locale: NameLocale): { type: CodexEntryType; title: string; fields: Record<string, string>; content: string; tags: string[] } {
  const labels = STEP_LABELS[locale], fields: Record<string, string> = {};
  fields[locale === 'es' ? 'Clase' : 'Kind'] = KIND_LABELS[locale][idea.kind];
  for (const step of KIND_STEPS[idea.kind]) if (step !== 'name' && idea.parts[step]) fields[labels[step]] = idea.parts[step]!;
  fields[locale === 'es' ? 'Estilo' : 'Style'] = STYLE_TABLES[idea.style].label[locale];
  const lines = KIND_STEPS[idea.kind].filter(step => step !== 'name' && idea.parts[step]).map(step => `<li><strong>${escape(labels[step])}:</strong> ${escape(idea.parts[step]!)}</li>`);
  const content = `${idea.brief ? `<p>${escape(idea.brief)}</p>` : ''}${lines.length ? `<ul>${lines.join('')}</ul>` : ''}`;
  return { type: KIND_CARD_TYPE[idea.kind], title: idea.parts.name ?? '?', fields, content, tags: [KIND_LABELS[locale][idea.kind]] };
}

export async function makeIdeaCard(projectId: string, idea: NameIdea, locale: NameLocale): Promise<CodexEntry> {
  const card = ideaCard(idea, locale), now = Date.now();
  const entry = { id: generateId(), projectId, type: card.type, title: card.title, content: card.content, fields: card.fields, tags: card.tags, relations: [], createdAt: now, updatedAt: now } as unknown as CodexEntry;
  await createCodexEntry(entry);
  return entry;
}
