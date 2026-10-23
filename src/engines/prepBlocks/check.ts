// A check block's roll: d20 plus the modifier, with advantage or disadvantage,
// against the difficulty. The result goes back on the block, and the roll is
// also kept in the project's dice tray when there is a project.
import { describeRoll, rollDice } from '@/engines/dice/dice';
import { logDiceRoll } from '@/engines/dice/operations';
import { checkHeadline, type CheckData } from './model';

export function outcomeFor(total: number, dc: number | null): 'pass' | 'miss' | null { return dc === null ? null : total >= dc ? 'pass' : 'miss'; }

export function rollCheck(data: CheckData, projectId?: string): CheckData {
  const expression = `1d20${data.bonus ? `${data.bonus > 0 ? '+' : '-'}${Math.abs(data.bonus)}` : ''}`;
  const roll = rollDice(expression, { mode: data.mode, label: checkHeadline(data) });
  const outcome = outcomeFor(roll.total, data.dc);
  if (projectId) void logDiceRoll(projectId, { ...roll, ...(data.dc !== null ? { target: data.dc, outcome: outcome ?? undefined } : {}) }).catch(() => undefined);
  return { ...data, result: { total: roll.total, detail: describeRoll(roll).replace(/~~/g, ''), outcome, natural: roll.natural ?? null, at: Date.now() } };
}
