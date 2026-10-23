// ============================================
// AI bridge — rules cards (a spell, magic item or creature from a Codex card)
// ============================================
// Builds the box the editor's "Ficha de reglas" inserts: each slot filled from
// the card property mapped to it (guessed from the property names unless the
// caller maps them), returned as manuscript HTML and Markdown, and — given a
// writing — added to the end of that chapter as an undoable write.

import { db } from '@/db';
import type { CodexEntry } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import { RULES_LAYOUTS, RULES_SLOTS, guessRulesSlots, normalizeRulesSlots, rulesCardHtml, rulesFieldNames, type RulesLayout } from '@/engines/codex/rulesCards';
import { tiptapHtmlToMarkdown } from '../markdown';
import { BridgeError } from './bridgeError';
import { assertEngineEnabled, assertRowInScope, optString, requireString, resolveProjectId, type ToolArgs } from './shared';
import { readEraRow } from '@/services/worldEras/store';
import { appendHtmlToWriting, mustGetWriting } from './writings';

export async function whCodexRulesCard(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const layout = requireString(args, 'layout') as RulesLayout;
  if (!RULES_LAYOUTS.includes(layout)) throw new BridgeError('bad-args', `layout is one of ${RULES_LAYOUTS.join(', ')}.`);
  await assertEngineEnabled(projectId, 'codex');
  const eraId = optString(args, 'eraId');
  const entry = (eraId ? await readEraRow<CodexEntry>({ projectId, eraId }, 'codexEntries', requireString(args, 'entryId')) : await db.codexEntries.get(requireString(args, 'entryId'))) as CodexEntry | undefined;
  if (!entry || entry.projectId !== projectId) throw new BridgeError('not-found', 'No codex entry with that id in this project.');
  const names = rulesFieldNames(entry);
  const given = args.slots;
  if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given))) throw new BridgeError('bad-args', 'slots maps a slot to a property name.');
  const slots = given === undefined ? guessRulesSlots(layout, names) : normalizeRulesSlots(layout, given, names);
  if (given && Object.keys(given as object).length !== Object.keys(slots).length) {
    const wrong = Object.entries(given as Record<string, unknown>).filter(([slot]) => !(slot in slots)).map(([slot, name]) => `${slot}→${String(name)}`);
    throw new BridgeError('bad-args', `Unknown slot or property: ${wrong.join(', ')}. Slots for ${layout}: ${RULES_SLOTS[layout].join(', ')}. Properties of the card: ${names.join(', ') || 'none'}.`);
  }
  const locale = optString(args, 'locale') ?? useLocaleStore.getState().locale;
  const card = rulesCardHtml(layout, entry, slots, locale, { description: args.includeDescription !== false });
  const result = { layout, entryId: entry.id, title: entry.title, properties: names, slots, filled: card.filled, missing: card.missing, html: card.html, markdown: tiptapHtmlToMarkdown(card.html) };
  const writingId = optString(args, 'writingId');
  if (!writingId) return result;
  await assertEngineEnabled(projectId, 'writings');
  const writing = await mustGetWriting(writingId, args);
  assertRowInScope(args, writing.projectId);
  if (writing.projectId !== projectId) throw new BridgeError('bad-args', 'The writing belongs to another project.');
  const appended = await appendHtmlToWriting(args, writing, card.html, `added rules card "${entry.title}" to writing "${writing.title}"`) as Record<string, unknown>;
  return { ...appended, ...result, writingId };
}
