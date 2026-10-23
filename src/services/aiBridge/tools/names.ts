// ============================================
// AI bridge — the name generator
// ============================================
// Ideas for an inn, a shop, a person, a village or a noble house in one of 13
// styles, made on this device from word tables (no model): the name and its
// parts (owner, charm, known for, secret, trouble, motto). With makeCard the
// idea becomes a Codex card (undoable).

import { db } from '@/db';
import { generateIdea, generateNames, type NameIdea } from '@/engines/names/generate';
import { makeIdeaCard } from '@/engines/names/makeCard';
import { KIND_STEPS, NAME_KINDS, NAME_STEPS, NAME_STYLES, type NameKind, type NameStep, type NameStyle } from '@/engines/names/types';
import { useLocaleStore } from '@/stores/localeStore';
import { BridgeError } from './bridgeError';
import { assertEngineEnabled, optNumber, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';

export async function whNameGenerate(args: ToolArgs): Promise<unknown> {
  const kind = (optString(args, 'kind') ?? 'inn') as NameKind, style = (optString(args, 'style') ?? 'classic') as NameStyle;
  if (!NAME_KINDS.includes(kind)) throw new BridgeError('bad-args', `kind is one of ${NAME_KINDS.join(', ')}.`);
  if (!NAME_STYLES.includes(style)) throw new BridgeError('bad-args', `style is one of ${NAME_STYLES.join(', ')}.`);
  const locale = (optString(args, 'locale') ?? useLocaleStore.getState().locale).startsWith('en') ? 'en' : 'es';
  const brief = (optString(args, 'brief') ?? '').slice(0, 200), seed = optString(args, 'seed') ?? crypto.randomUUID().slice(0, 12);
  const count = Math.max(1, Math.min(10, Math.round(optNumber(args, 'count') ?? 1)));
  if (args.makeCard === true) {
    const projectId = resolveProjectId(args);
    if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
    if (optString(args, 'eraId')) throw new BridgeError('bad-args', 'Cards are made in the shared base, not inside an era.');
    await assertEngineEnabled(projectId, 'codex');
    let idea: NameIdea = generateIdea(kind, style, seed, locale, brief);
    // The author's own wording wins over the generated part.
    const parts = args.parts && typeof args.parts === 'object' ? args.parts as Record<string, unknown> : {};
    for (const [step, value] of Object.entries(parts)) {
      if (!(NAME_STEPS as readonly string[]).includes(step) || !KIND_STEPS[kind].includes(step as NameStep)) throw new BridgeError('bad-args', `parts for a ${kind} are ${KIND_STEPS[kind].join(', ')}.`);
      if (value === null) { const next = { ...idea.parts }; delete next[step as NameStep]; idea = { ...idea, parts: next }; }
      else if (typeof value === 'string' && value.trim()) idea = { ...idea, parts: { ...idea.parts, [step]: value.trim().slice(0, 200) } };
    }
    const entry = await makeIdeaCard(projectId, idea, locale);
    return withAudit({ entryId: entry.id, title: entry.title, type: entry.type, fields: entry.fields, seed }, { projectId, entityId: entry.id, table: 'codexEntries', kind: 'create', summary: `made the card "${entry.title}" from the name generator` });
  }
  const ideas = Array.from({ length: count }, (_, index) => generateIdea(kind, style, count > 1 ? `${seed}-${index}` : seed, locale, brief));
  return { kind, style, seed, ideas: ideas.map(idea => idea.parts), ...(args.namesOnly === true ? { names: generateNames(kind, style, seed, locale, Math.max(count, 8), brief) } : {}) };
}
