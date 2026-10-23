// ============================================
// Table rules: how the table plays, kept with the project
// ============================================
// One record per project: the game system, the few rules the table has
// changed from the usual ones, and a reorderable list of notes about the
// evening itself (when, where, house rules, food, dress code, anything else).
//
// Only what differs from the default is stored in `values`, so "changed from
// defaults" is simply "present" and a reset is a delete. Nothing here imports
// the database or React: the bridge manifest and the panel share it.

export const TABLE_SYSTEMS = ['5e-2024', '5e-2014', 'daggerheart', 'coc7', 'free'] as const;
export type TableSystem = typeof TABLE_SYSTEMS[number];
export type RuleValue = string | number | boolean;
export interface InfoSection { id: string; title: string; text: string }
export interface TableRules { revision: number; system: TableSystem; values: Record<string, RuleValue>; info: InfoSection[] }

export const TABLE_RULES_LIMITS = { values: 80, info: 40, title: 120, text: 4000 } as const;
export const EMPTY_TABLE_RULES: TableRules = { revision: 0, system: '5e-2024', values: {}, info: [] };

interface Bi { es: string; en: string }
export type RuleGroup = 'creation' | 'play' | 'rests' | 'house';
export interface RuleDef {
  id: string; group: RuleGroup; kind: 'choice' | 'toggle' | 'number' | 'text';
  label: Bi; help?: Bi; systems: readonly TableSystem[];
  options?: { value: string; label: Bi }[]; min?: number; max?: number;
  /** Used where `defaults` has no entry for the system. */
  fallback: RuleValue; defaults?: Partial<Record<TableSystem, RuleValue>>;
}

export const GROUP_LABELS: Record<RuleGroup, Bi> = {
  creation: { es: 'Crear personajes', en: 'Making characters' },
  play: { es: 'En la partida', en: 'During play' },
  rests: { es: 'Descansos', en: 'Rests' },
  house: { es: 'Reglas de la casa', en: 'House rules' },
};
export const SYSTEM_LABELS: Record<TableSystem, Bi> = {
  '5e-2024': { es: 'D&D 5e (reglas 2024)', en: 'D&D 5e (2024 rules)' },
  '5e-2014': { es: 'D&D 5e (reglas 2014)', en: 'D&D 5e (2014 rules)' },
  daggerheart: { es: 'Daggerheart', en: 'Daggerheart' },
  coc7: { es: 'La llamada de Cthulhu (7ª)', en: 'Call of Cthulhu (7th)' },
  free: { es: 'Sistema libre', en: 'Freeform' },
};

const FIVE: readonly TableSystem[] = ['5e-2024', '5e-2014'];
const ALL: readonly TableSystem[] = TABLE_SYSTEMS;
const opt = (value: string, es: string, en: string) => ({ value, label: { es, en } });
const choice = (id: string, group: RuleGroup, systems: readonly TableSystem[], es: string, en: string, options: ReturnType<typeof opt>[], fallback: string, defaults?: Partial<Record<TableSystem, RuleValue>>, help?: Bi): RuleDef => ({ id, group, kind: 'choice', label: { es, en }, systems, options, fallback, ...(defaults ? { defaults } : {}), ...(help ? { help } : {}) });
const toggle = (id: string, group: RuleGroup, systems: readonly TableSystem[], es: string, en: string, fallback: boolean, defaults?: Partial<Record<TableSystem, RuleValue>>, help?: Bi): RuleDef => ({ id, group, kind: 'toggle', label: { es, en }, systems, fallback, ...(defaults ? { defaults } : {}), ...(help ? { help } : {}) });
const num = (id: string, group: RuleGroup, systems: readonly TableSystem[], es: string, en: string, min: number, max: number, fallback: number): RuleDef => ({ id, group, kind: 'number', label: { es, en }, systems, min, max, fallback });
const text = (id: string, group: RuleGroup, systems: readonly TableSystem[], es: string, en: string, help?: Bi): RuleDef => ({ id, group, kind: 'text', label: { es, en }, systems, fallback: '', ...(help ? { help } : {}) });

const DICE = choice('dice', 'play', ALL, 'Dados', 'Dice', [opt('screen', 'En pantalla', 'On screen'), opt('own', 'Propios, en la mesa', 'Own, at the table'), opt('both', 'Ambos', 'Both')], 'both');

/** Every rule of every system; a rule shared by several systems keeps one id. */
export const RULES: readonly RuleDef[] = [
  num('startingLevel', 'creation', FIVE, 'Nivel inicial', 'Starting level', 1, 20, 1),
  num('startingLevelDh', 'creation', ['daggerheart'], 'Nivel inicial', 'Starting level', 1, 10, 1),
  choice('abilityScores', 'creation', FIVE, 'Características', 'Ability scores', [opt('standard-array', 'Serie estándar', 'Standard array'), opt('point-buy', 'Compra de puntos', 'Point buy'), opt('roll', 'Tirar dados', 'Roll')], 'standard-array'),
  choice('hitPoints', 'creation', FIVE, 'Puntos de vida al subir de nivel', 'Hit points on level-up', [opt('fixed', 'Fijos (la media)', 'Fixed (the average)'), opt('rolled', 'Tirados', 'Rolled')], 'fixed', undefined, { es: 'La ficha propone siempre la media; si tiráis, anota la tirada a mano.', en: 'The sheet always proposes the average; if you roll, enter the roll by hand.' }),
  toggle('feats', 'creation', FIVE, 'Dotes', 'Feats', true, { '5e-2014': false }),
  toggle('multiclass', 'creation', FIVE, 'Multiclase', 'Multiclassing', true, { '5e-2014': false }),
  choice('startingGear', 'creation', FIVE, 'Equipo inicial', 'Starting gear', [opt('kit', 'Equipo de la clase', 'Class kit'), opt('gold', 'Oro para comprar', 'Gold to spend')], 'kit'),
  choice('characteristics', 'creation', ['coc7'], 'Características', 'Characteristics', [opt('roll', 'Tirar dados', 'Roll'), opt('point-buy', 'Compra de puntos', 'Point buy')], 'roll'),
  choice('era', 'creation', ['coc7'], 'Época', 'Era', [opt('1920s', 'Años 20', '1920s'), opt('gaslight', 'Época victoriana', 'Gaslight'), opt('modern', 'Actual', 'Modern')], '1920s'),
  text('characterCreation', 'creation', ['free'], 'Cómo se crean los personajes', 'How characters are made'),

  DICE,
  choice('levelling', 'play', [...FIVE, 'free'], 'Subir de nivel', 'Levelling', [opt('milestone', 'Por hitos', 'Milestones'), opt('xp', 'Por experiencia', 'Experience points')], 'milestone'),
  choice('criticalDamage', 'play', FIVE, 'Daño crítico', 'Critical damage', [opt('double-dice', 'Dados dobles', 'Double the dice'), opt('max-plus-roll', 'Máximo + tirada', 'Max + roll'), opt('double-total', 'Doble del total', 'Double the total')], 'double-dice'),
  toggle('flanking', 'play', FIVE, 'Flanquear da ventaja', 'Flanking gives advantage', false),
  choice('potionAction', 'play', FIVE, 'Beber una poción', 'Drinking a potion', [opt('action', 'Cuesta una acción', 'Takes an action'), opt('bonus', 'Cuesta una acción adicional', 'Takes a bonus action')], 'action', { '5e-2024': 'bonus' }),
  choice('encumbrance', 'play', FIVE, 'Carga', 'Carrying', [opt('simple', 'Simple', 'Simple'), opt('detailed', 'Detallada', 'Detailed'), opt('none', 'No se lleva la cuenta', 'Not tracked')], 'simple'),
  toggle('coinWeight', 'play', FIVE, 'Las monedas pesan', 'Coins have weight', false),
  toggle('inspiration', 'play', FIVE, 'Inspiración', 'Inspiration', true),
  choice('deathSaves', 'play', FIVE, 'Salvaciones de muerte', 'Death saves', [opt('public', 'A la vista de todos', 'In the open'), opt('secret', 'En secreto', 'In secret')], 'public'),
  toggle('experiences', 'play', ['daggerheart'], 'Experiencias', 'Experiences', true),
  choice('fear', 'play', ['daggerheart'], 'Miedo', 'Fear', [opt('shown', 'Visible para todos', 'Shown to everyone'), opt('hidden', 'Oculto', 'Hidden')], 'shown'),
  choice('gold', 'play', ['daggerheart'], 'Oro', 'Gold', [opt('handfuls', 'Puñados, bolsas y cofres', 'Handfuls, bags and chests'), opt('coins', 'Monedas contadas', 'Counted coins')], 'handfuls'),
  toggle('luckSpending', 'play', ['coc7'], 'Gastar Suerte para cambiar tiradas', 'Spend Luck to change rolls', false),
  toggle('pushedRolls', 'play', ['coc7'], 'Tiradas forzadas', 'Pushed rolls', true),
  toggle('pulp', 'play', ['coc7'], 'Tono pulp (héroes más duros)', 'Pulp tone (tougher heroes)', false),

  choice('restVariant', 'rests', FIVE, 'Ritmo de los descansos', 'Rest pace', [opt('standard', 'Estándar (1 hora / 8 horas)', 'Standard (1 hour / 8 hours)'), opt('gritty', 'Crudo (8 horas / 1 semana)', 'Gritty (8 hours / 1 week)'), opt('heroic', 'Heroico (5 minutos / 1 hora)', 'Heroic (5 minutes / 1 hour)')], 'standard'),
  choice('restsCycle', 'rests', ['daggerheart'], 'Ciclo de descansos', 'Rest cycle', [opt('standard', 'Según el reglamento', 'As written'), opt('free', 'Libre, sin tope de descansos cortos seguidos', 'Free, no cap on short rests in a row')], 'standard'),

  text('houseRules', 'house', ALL, 'Reglas propias', 'Our own rules', { es: 'Lo que vuestra mesa hace distinto y no cabe en las casillas de arriba.', en: 'What your table does differently that the boxes above do not cover.' }),
];

export const rulesFor = (system: TableSystem): RuleDef[] => RULES.filter(rule => rule.systems.includes(system));
export const ruleDefault = (rule: RuleDef, system: TableSystem): RuleValue => rule.defaults?.[system] ?? rule.fallback;
const byId = new Map(RULES.map(rule => [rule.id, rule]));
export const ruleById = (id: string) => byId.get(id);

/** The value in force: the table's own, else the default of its system. */
export function ruleValue(rules: TableRules, id: string): RuleValue | undefined {
  const rule = byId.get(id);
  if (!rule || !rule.systems.includes(rules.system)) return undefined;
  return id in rules.values ? rules.values[id] : ruleDefault(rule, rules.system);
}
export const ruleChanged = (rules: TableRules, rule: RuleDef) => rule.systems.includes(rules.system) && rule.id in rules.values && rules.values[rule.id] !== ruleDefault(rule, rules.system);
export const changedRuleIds = (rules: TableRules) => rulesFor(rules.system).filter(rule => ruleChanged(rules, rule)).map(rule => rule.id);

/** Check one value against its rule; returns it as stored. */
export function checkRuleValue(rule: RuleDef, value: unknown): RuleValue {
  if (rule.kind === 'toggle') { if (typeof value !== 'boolean') throw new Error('rule_value'); return value; }
  if (rule.kind === 'number') { if (typeof value !== 'number' || !Number.isInteger(value) || value < (rule.min ?? 0) || value > (rule.max ?? 1000)) throw new Error('rule_value'); return value; }
  if (typeof value !== 'string') throw new Error('rule_value');
  if (rule.kind === 'choice') { if (!rule.options!.some(item => item.value === value)) throw new Error('rule_value'); return value; }
  if (value.length > TABLE_RULES_LIMITS.text) throw new Error('rule_value');
  return value;
}

export function validateTableRules(rules: Pick<TableRules, 'system' | 'values' | 'info'>): void {
  if (!TABLE_SYSTEMS.includes(rules.system)) throw new Error('rules_system');
  const keys = Object.keys(rules.values);
  if (keys.length > TABLE_RULES_LIMITS.values) throw new Error('rules_limit');
  for (const key of keys) { const rule = byId.get(key); if (!rule) throw new Error('rule_unknown'); checkRuleValue(rule, rules.values[key]); }
  if (rules.info.length > TABLE_RULES_LIMITS.info) throw new Error('rules_info_limit');
  const seen = new Set<string>();
  for (const item of rules.info) {
    if (!item.id || seen.has(item.id)) throw new Error('rules_info_id');
    seen.add(item.id);
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > TABLE_RULES_LIMITS.title) throw new Error('rules_info_title');
    if (typeof item.text !== 'string' || item.text.length > TABLE_RULES_LIMITS.text) throw new Error('rules_info_text');
  }
}

/**
 * Apply a patch {ruleId: value | null} for `system`. null (or the default
 * itself) puts the rule back to its default, so only differences are stored.
 */
export function patchRuleValues(values: Record<string, RuleValue>, system: TableSystem, patch: Record<string, unknown>): Record<string, RuleValue> {
  const next = { ...values };
  for (const [id, raw] of Object.entries(patch)) {
    const rule = byId.get(id);
    if (!rule || !rule.systems.includes(system)) throw new Error(`rule_unknown:${id}`);
    if (raw === null) { delete next[id]; continue; }
    let value: RuleValue;
    try { value = checkRuleValue(rule, raw); } catch { throw new Error(`rule_value:${id}`); }
    if (value === ruleDefault(rule, system)) delete next[id]; else next[id] = value;
  }
  return next;
}
/** Every rule of `system` back to its default; rules of other systems stay as they were. */
export function resetAllValues(values: Record<string, RuleValue>, system: TableSystem): Record<string, RuleValue> {
  const mine = new Set(rulesFor(system).map(rule => rule.id));
  return Object.fromEntries(Object.entries(values).filter(([id]) => !mine.has(id)));
}

export type InfoOp =
  | { op: 'add'; title: string; text?: string; index?: number }
  | { op: 'update'; id?: string; match?: string; title?: string; text?: string }
  | { op: 'remove'; id?: string; match?: string }
  | { op: 'move'; id?: string; match?: string; to: number };

export const newInfo = (title: string, body = ''): InfoSection => ({ id: crypto.randomUUID(), title: title.trim().slice(0, TABLE_RULES_LIMITS.title), text: body });

/** The suggested sections the panel offers as one-click starters. */
export const SUGGESTED_INFO: { key: string; title: Bi }[] = [
  { key: 'when', title: { es: 'Cuándo jugamos', en: 'When we play' } },
  { key: 'where', title: { es: 'Dónde jugamos', en: 'Where we play' } },
  { key: 'house', title: { es: 'Reglas de la casa', en: 'House rules' } },
  { key: 'food', title: { es: 'Comida y bebida', en: 'Food and drink' } },
  { key: 'dress', title: { es: 'Vestimenta', en: 'Dress code' } },
];

/** Run list operations in order on a copy; throws `rules_info_missing` when a section cannot be found. */
export function applyInfoOps(info: InfoSection[], ops: InfoOp[]): InfoSection[] {
  let list = info.map(item => ({ ...item }));
  const find = (op: { id?: string; match?: string }) => {
    const at = op.id ? list.findIndex(item => item.id === op.id) : op.match ? list.findIndex(item => item.title.toLocaleLowerCase().includes(op.match!.toLocaleLowerCase())) : -1;
    if (at < 0) throw new Error('rules_info_missing');
    return at;
  };
  for (const op of ops) {
    if (op.op === 'add') {
      const item = newInfo(op.title, op.text ?? ''), at = op.index === undefined ? list.length : Math.max(0, Math.min(list.length, op.index));
      list = [...list.slice(0, at), item, ...list.slice(at)];
    } else if (op.op === 'update') {
      const at = find(op); list[at] = { ...list[at], ...(op.title !== undefined ? { title: op.title.trim() } : {}), ...(op.text !== undefined ? { text: op.text } : {}) };
    } else if (op.op === 'remove') {
      list.splice(find(op), 1);
    } else if (op.op === 'move') {
      const at = find(op), [item] = list.splice(at, 1); list.splice(Math.max(0, Math.min(list.length, op.to)), 0, item);
    } else throw new Error('rules_info_op');
  }
  return list;
}

/** Move one section up or down by one place (the panel's arrows). */
export function moveInfo(info: InfoSection[], id: string, delta: -1 | 1): InfoSection[] {
  const at = info.findIndex(item => item.id === id), to = at + delta;
  if (at < 0 || to < 0 || to >= info.length) return info;
  const next = [...info]; [next[at], next[to]] = [next[to], next[at]]; return next;
}
