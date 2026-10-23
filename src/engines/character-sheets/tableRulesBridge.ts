// ============================================
// AI bridge — the table's rules
// ============================================
// wh_table_rules_get reads the system, every rule with its default and whether
// the table changed it, and the notes about the evening. wh_table_rules_set
// changes them as the "Reglas de la mesa" panel does; every change can be
// undone, and a stale revision is refused.

import { BridgeError, optNumber, optString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { tableRulesStamp } from '@/services/aiBridge/undoStamp';
import { db } from '@/db';
import { TABLE_SYSTEMS, applyInfoOps, changedRuleIds, patchRuleValues, resetAllValues, ruleChanged, ruleDefault, ruleValue, rulesFor, type InfoOp, type TableRules, type TableSystem } from './tableRules';
import { TableRulesConflict, readTableRules, saveTableRules } from './tableRulesOperations';

const view = (projectId: string, rules: TableRules) => ({
  projectId, revision: rules.revision, system: rules.system, systems: [...TABLE_SYSTEMS],
  rules: rulesFor(rules.system).map(rule => ({ id: rule.id, group: rule.group, kind: rule.kind, label: rule.label.en, value: ruleValue(rules, rule.id), default: ruleDefault(rule, rules.system), changed: ruleChanged(rules, rule), ...(rule.options ? { options: rule.options.map(item => item.value) } : {}), ...(rule.kind === 'number' ? { min: rule.min, max: rule.max } : {}) })),
  changed: changedRuleIds(rules), info: rules.info,
});

function readOps(value: unknown): InfoOp[] {
  if (!Array.isArray(value) || value.length > 40) throw new BridgeError('bad-args', 'infoOps is a list of up to 40 operations.');
  return value.map((raw, index): InfoOp => {
    const item = raw as Record<string, unknown>, text = (key: string) => item[key] === undefined ? undefined : typeof item[key] === 'string' ? item[key] as string : (() => { throw new BridgeError('bad-args', `infoOps[${index}].${key} must be text.`); })();
    const op = item?.op;
    if (op === 'add') { const title = text('title'); if (!title?.trim()) throw new BridgeError('bad-args', `infoOps[${index}] add needs a title.`); return { op, title, text: text('text'), ...(typeof item.index === 'number' ? { index: item.index } : {}) }; }
    if (op === 'update') return { op, id: text('id'), match: text('match'), title: text('title'), text: text('text') };
    if (op === 'remove') return { op, id: text('id'), match: text('match') };
    if (op === 'move') { if (typeof item.to !== 'number' || !Number.isInteger(item.to)) throw new BridgeError('bad-args', `infoOps[${index}] move needs an integer "to" position.`); return { op, id: text('id'), match: text('match'), to: item.to }; }
    throw new BridgeError('bad-args', `infoOps[${index}].op is add, update, remove or move.`);
  });
}

export const TABLE_RULES_HANDLERS = {
  async wh_table_rules_get(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
    return view(projectId, await readTableRules(projectId));
  },
  async wh_table_rules_set(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'character-sheets');
    if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
    const before = await readTableRules(projectId), expected = optNumber(args, 'expectedRevision');
    if (expected !== undefined && expected !== before.revision) throw new BridgeError('conflict', `The table rules are at revision ${before.revision}; read them again.`);
    const system = optString(args, 'system') as TableSystem | undefined;
    if (system !== undefined && !TABLE_SYSTEMS.includes(system)) throw new BridgeError('bad-args', `system is one of ${TABLE_SYSTEMS.join(', ')}.`);
    const patch = args.values;
    if (patch !== undefined && (typeof patch !== 'object' || patch === null || Array.isArray(patch))) throw new BridgeError('bad-args', 'values is an object {ruleId: value, or null to restore the default}.');
    if (args.resetAll !== undefined && typeof args.resetAll !== 'boolean') throw new BridgeError('bad-args', 'resetAll is true or false.');
    const ops = args.infoOps === undefined ? undefined : readOps(args.infoOps);
    if (system === undefined && patch === undefined && !args.resetAll && !ops) throw new BridgeError('bad-args', 'Give at least one of system, values, resetAll or infoOps.');
    try {
      const nextSystem = system ?? before.system;
      let values = before.values;
      if (args.resetAll) values = resetAllValues(values, nextSystem);
      if (patch) values = patchRuleValues(values, nextSystem, patch as Record<string, unknown>);
      const info = ops ? applyInfoOps(before.info, ops) : before.info;
      const next = { system: nextSystem, values, info };
      if (tableRulesStamp(next) === tableRulesStamp(before)) return { ...view(projectId, before), unchanged: true };
      const saved = await saveTableRules(projectId, next, before.revision);
      return withAudit(view(projectId, saved), { projectId, entityId: projectId, kind: 'update', summary: 'change the table rules', before: { __tableRules: before, __after: tableRulesStamp(saved), __afterRevision: saved.revision } });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error instanceof TableRulesConflict) throw new BridgeError('conflict', 'The table rules changed meanwhile; read them again.');
      const code = error instanceof Error ? error.message : '';
      if (code.startsWith('rule_unknown:')) throw new BridgeError('bad-args', `"${code.slice(13)}" is not a rule of ${system ?? before.system}; read wh_table_rules_get for its rules.`);
      if (code.startsWith('rule_value:')) throw new BridgeError('bad-args', `"${code.slice(11)}" has a value its rule does not accept; read wh_table_rules_get for the options.`);
      throw new BridgeError(code === 'rules_info_missing' ? 'not-found' : 'bad-args', code === 'rules_info_missing' ? 'No such section; give id (from wh_table_rules_get) or match (words of its title).' : code === 'rules_info_title' ? 'A section title is 1-120 characters.' : code === 'rules_info_text' ? 'A section text is up to 4000 characters.' : code === 'rules_info_limit' ? 'Up to 40 sections.' : 'Invalid table rules.');
    }
  },
};
