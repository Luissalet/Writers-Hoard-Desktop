// The tray's memory, kept with the project: the last rolls and the saved
// formulas ("Ataque con espada: 1d20+5"). Rolls are appended in a transaction
// so two windows rolling at once both land.
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { parseDice, type DiceRoll } from './dice';

export interface DiceFormula { id: string; label: string; expression: string }
export interface DiceTray { log: DiceRoll[]; formulas: DiceFormula[] }
export const DICE_LOG_LIMIT = 40, DICE_FORMULA_LIMIT = 30;

export async function readDiceTray(projectId: string): Promise<DiceTray> {
  const tray = (await db.projects.get(projectId))?.diceTray;
  return { log: tray?.log ?? [], formulas: tray?.formulas ?? [] };
}

async function change(projectId: string, apply: (tray: DiceTray) => DiceTray): Promise<DiceTray> {
  const next = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const tray = apply({ log: project.diceTray?.log ?? [], formulas: project.diceTray?.formulas ?? [] });
    const saved = { log: tray.log.slice(-DICE_LOG_LIMIT), formulas: tray.formulas.slice(0, DICE_FORMULA_LIMIT) };
    await db.projects.update(projectId, { diceTray: saved, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return saved;
  });
  notifyProjectsChanged();
  return next;
}

export const logDiceRoll = (projectId: string, roll: DiceRoll) => change(projectId, tray => ({ ...tray, log: [...tray.log, roll] }));
export const clearDiceLog = (projectId: string) => change(projectId, tray => ({ ...tray, log: [] }));
export const restoreDiceTray = (projectId: string, previous: DiceTray) => change(projectId, () => previous);

export function saveDiceFormula(projectId: string, label: string, expression: string): Promise<DiceTray> {
  const name = label.trim().slice(0, 60); if (!name) throw new Error('formula_label_required');
  parseDice(expression);
  return change(projectId, tray => {
    const existing = tray.formulas.find(item => item.label.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!existing && tray.formulas.length >= DICE_FORMULA_LIMIT) throw new Error('formula_limit');
    return { ...tray, formulas: existing ? tray.formulas.map(item => item === existing ? { ...item, label: name, expression: expression.trim() } : item) : [...tray.formulas, { id: crypto.randomUUID(), label: name, expression: expression.trim() }] };
  });
}
export const removeDiceFormula = (projectId: string, id: string) => change(projectId, tray => ({ ...tray, formulas: tray.formulas.filter(item => item.id !== id) }));
