// ============================================
// AI bridge — the dice tray
// ============================================
// Roll with the tray's grammar (advantage, a target, natural 20 / 1), keep the
// roll in the project's log when a project is given, read the log and manage
// the saved formulas. Formula changes and clearing the log can be undone.

import { db } from '@/db';
import { describeRoll, rollDice, type DiceMode } from '@/engines/dice/dice';
import { clearDiceLog, logDiceRoll, readDiceTray, removeDiceFormula, saveDiceFormula } from '@/engines/dice/operations';
import { diceStamp } from '../undoStamp';
import { BridgeError } from './bridgeError';
import { optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

const MODES: DiceMode[] = ['normal', 'advantage', 'disadvantage'];

export async function whDiceRoll(args: ToolArgs): Promise<unknown> {
  const mode = (optString(args, 'mode') ?? 'normal') as DiceMode;
  if (!MODES.includes(mode)) throw new BridgeError('bad-args', `mode is one of ${MODES.join(', ')}.`);
  const times = Math.max(1, Math.min(20, Math.round(optNumber(args, 'times') ?? 1)));
  const expression = requireString(args, 'expression'), target = optNumber(args, 'target'), label = optString(args, 'label');
  const projectId = typeof args.projectId === 'string' && args.projectId ? resolveProjectId(args) : undefined;
  if (projectId && !await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const rolls = [];
  try { for (let i = 0; i < times; i++) rolls.push(rollDice(expression, { mode, ...(target !== undefined ? { target } : {}), ...(label ? { label } : {}) })); }
  catch (error) { throw new BridgeError('bad-args', error instanceof Error && error.message === 'dice_limit' ? 'Up to 100 dice of at most 1000 sides per roll.' : 'Write rolls like 1d20+5, 2d6+1d8-1, 4d6kh3 or d%.'); }
  if (projectId) for (const roll of rolls) await logDiceRoll(projectId, roll);
  return { rolls: rolls.map(roll => ({ total: roll.total, text: describeRoll(roll), ...(roll.natural ? { natural: roll.natural } : {}), ...(roll.outcome ? { outcome: roll.outcome, target: roll.target } : {}), dice: roll.terms.map(term => ({ sides: term.sides, rolls: term.rolls, kept: term.kept })) })), ...(projectId ? { logged: true } : {}) };
}

export async function whDiceTray(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const action = optString(args, 'action') ?? 'read', before = await readDiceTray(projectId);
  const audit = (summary: string, after: Awaited<ReturnType<typeof readDiceTray>>) => ({ projectId, entityId: projectId, kind: 'update' as const, summary, before: { __diceTray: before, __after: diceStamp(after) } });
  switch (action) {
    case 'read': return { log: before.log.map(roll => ({ at: roll.at, label: roll.label ?? null, expression: roll.expression, total: roll.total, text: describeRoll(roll), ...(roll.natural ? { natural: roll.natural } : {}), ...(roll.outcome ? { outcome: roll.outcome } : {}) })), formulas: before.formulas };
    case 'clear-log': { const tray = await clearDiceLog(projectId); return withAudit({ cleared: before.log.length }, audit('cleared the dice log', tray)); }
    case 'save-formula': {
      try { const tray = await saveDiceFormula(projectId, requireString(args, 'label'), requireString(args, 'expression')); return withAudit({ formulas: tray.formulas }, audit(`saved the dice formula "${requireString(args, 'label')}"`, tray)); }
      catch (error) { if (error instanceof BridgeError) throw error; throw new BridgeError('bad-args', error instanceof Error && error.message === 'formula_limit' ? 'Up to 30 saved formulas.' : 'Give a label and a roll like 1d20+5.'); }
    }
    case 'remove-formula': {
      const label = requireString(args, 'label'), found = before.formulas.find(item => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
      if (!found) throw new BridgeError('not-found', `No formula "${label}"; saved: ${before.formulas.map(item => item.label).join(', ') || 'none'}.`);
      const tray = await removeDiceFormula(projectId, found.id); return withAudit({ formulas: tray.formulas }, audit(`removed the dice formula "${found.label}"`, tray));
    }
    default: throw new BridgeError('bad-args', 'action is read, clear-log, save-formula or remove-formula.');
  }
}
