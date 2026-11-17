// AI bridge handlers for the travel verifier and the state ledger.
import { db } from '@/db';
import { assertEngineEnabled, BridgeError, optBoolean, optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import type { TravelMode } from '@/engines/worldgen/core/travel';
import { buildContinuityReport, characterStateAt, dayText, type ContinuityReport } from './report';
import { addLedgerEntry, removeLedgerEntry, setIntentional, setTravelMode, type ContinuityReceipt } from './ledgerOps';
import { VOICE_HANDLERS } from '@/services/voice/bridge';

function audited<T extends object>(projectId: string, receipt: ContinuityReceipt, summary: string, result: T): T {
  return withAudit(result, { projectId, entityId: receipt.characterId, kind: 'update', summary, before: receipt.before ? { continuity: receipt.before } : { __absent: ['continuity'] } });
}

async function characterIn(projectId: string, characterId: string) {
  const entry = await db.codexEntries.get(characterId);
  if (!entry || entry.projectId !== projectId) throw new BridgeError('not-found', `No Codex card "${characterId}" in this project.`);
  if (entry.type !== 'character') throw new BridgeError('bad-args', `"${entry.title}" is not a character card.`);
  return entry;
}

function chapterTitle(report: ContinuityReport, writingId: string): string {
  const c = report.chapters.find((row) => row.writingId === writingId);
  return c ? (c.chapter !== null ? `${c.chapter}. ${c.title}` : c.title) : writingId;
}

function wrap<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((error) => { throw error instanceof BridgeError ? error : new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); });
}

export const CONTINUITY_HANDLERS = {
  async wh_travel_check(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId');
    if (characterId) await characterIn(projectId, characterId);
    const report = await buildContinuityReport(projectId, { eraId: optString(args, 'eraId'), characterId });
    const only = optBoolean(args, 'onlyProblems');
    const legs = report.legs.filter((leg) => !only || leg.verdict === 'impossible' || leg.verdict === 'tight');
    return {
      projectId, calendar: report.calendar?.name ?? null, pendingWorlds: report.pendingWorlds,
      legs: legs.map((leg) => ({
        id: leg.id, character: report.titles[leg.characterId] ?? leg.characterId, characterId: leg.characterId, verdict: leg.verdict, ...(leg.reason ? { reason: leg.reason } : {}),
        from: { place: leg.from.label, chapter: chapterTitle(report, leg.from.writingId), writingId: leg.from.writingId, worldId: leg.from.worldId, x: leg.from.x, y: leg.from.y, source: leg.from.source },
        to: { place: leg.to.label, chapter: chapterTitle(report, leg.to.writingId), writingId: leg.to.writingId, worldId: leg.to.worldId, x: leg.to.x, y: leg.to.y, source: leg.to.source },
        availableDays: leg.availableDays, neededDays: leg.neededDays, km: leg.km,
        ...(leg.minStart !== undefined ? { earliestStart: dayText(report.calendar, leg.minStart) } : {}),
        ...(leg.intentional !== undefined ? { intended: leg.intentional } : {}),
      })),
      counts: { impossible: legs.filter((l) => l.verdict === 'impossible' && l.intentional === undefined).length, tight: legs.filter((l) => l.verdict === 'tight').length, unknown: legs.filter((l) => l.verdict === 'unknown').length },
    };
  },

  async wh_character_state(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = requireString(args, 'characterId');
    await characterIn(projectId, characterId);
    const report = await buildContinuityReport(projectId, { skipTravel: true });
    const writingId = optString(args, 'writingId');
    const chapter = writingId ? report.chapters.find((c) => c.writingId === writingId)?.chapter : optNumber(args, 'chapter');
    if (chapter === undefined || chapter === null) throw new BridgeError('bad-args', writingId ? 'That writing has no chapter number, so it has no place in the story order.' : 'Pass chapter (a number) or writingId.');
    const state = characterStateAt(report, characterId, chapter);
    const name = (id?: string) => (id ? report.titles[id] ?? id : undefined);
    return {
      character: report.titles[characterId], chapter,
      location: state.location ? { ...state.location, since: chapterTitle(report, state.location.since) } : null,
      knows: state.knows.map((k) => ({ fact: k.fact ?? name(k.entryId) ?? k.seedId, ...(k.seedId ? { seedId: k.seedId } : {}), ...(k.entryId ? { entryId: k.entryId } : {}), since: chapterTitle(report, k.since) })),
      carries: state.carries.map((c) => ({ item: c.item ?? name(c.itemId), ...(c.itemId ? { itemId: c.itemId } : {}), since: chapterTitle(report, c.since) })),
      condition: state.condition ? { text: state.condition.text, since: chapterTitle(report, state.condition.since) } : null,
      alive: state.alive, ...(state.diedIn ? { diedIn: chapterTitle(report, state.diedIn) } : {}),
    };
  },

  async wh_state_ledger(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId');
    if (characterId) await characterIn(projectId, characterId);
    const report = await buildContinuityReport(projectId, { skipTravel: true });
    const people = report.characters.filter((c) => !characterId || c.id === characterId);
    return {
      characters: people.map((c) => ({ characterId: c.id, character: c.title, travelMode: c.continuity.travelMode ?? 'foot', lines: (c.continuity.ledger ?? []).map((line) => ({ ...line, chapter: chapterTitle(report, line.writingId) })) })),
      findings: report.stateFindings.filter((f) => !characterId || f.characterId === characterId).map((f) => ({ ...f, character: report.titles[f.characterId], chapterTitle: chapterTitle(report, f.writingId) })),
    };
  },

  wh_state_ledger_add: (args: ToolArgs) => wrap(async () => {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'codex');
    const characterId = requireString(args, 'characterId');
    await characterIn(projectId, characterId);
    const { projectId: _p, characterId: _c, ...input } = args as Record<string, unknown>;
    void _p; void _c;
    const receipt = await addLedgerEntry(projectId, characterId, { ...input, source: 'author' } as never);
    return audited(projectId, receipt, `Add a ${receipt.entry.kind} line to the state ledger`, { added: true, line: receipt.entry });
  }),

  wh_state_ledger_remove: (args: ToolArgs) => wrap(async () => {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'codex');
    const characterId = requireString(args, 'characterId');
    const receipt = await removeLedgerEntry(projectId, characterId, requireString(args, 'lineId'));
    return audited(projectId, receipt, 'Remove a state ledger line', { removed: true });
  }),

  wh_continuity_mark: (args: ToolArgs) => wrap(async () => {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'codex');
    const characterId = requireString(args, 'characterId');
    const findingId = optString(args, 'findingId'), mode = optString(args, 'travelMode');
    if (!findingId && !mode) throw new BridgeError('bad-args', 'Pass findingId (with note) or travelMode.');
    if (findingId && mode) throw new BridgeError('bad-args', 'Pass findingId or travelMode, one per call.');
    if (mode) {
      const receipt = await setTravelMode(projectId, characterId, mode as TravelMode);
      return audited(projectId, receipt, 'Set travel mode', { travelMode: mode });
    }
    const note = optString(args, 'note') ?? '';
    const receipt = await setIntentional(projectId, characterId, findingId!, note.trim() ? note : null);
    return audited(projectId, receipt, note.trim() ? 'Mark a continuity finding as intended' : 'Unmark a continuity finding', { findingId, intended: note.trim() || null });
  }),
  // The novelist checks that read the manuscript beside continuity.
  ...VOICE_HANDLERS,
};
