// The dice tray's arithmetic: a small dice grammar (2d6+1d8+3, 4d6kh3, d%),
// advantage and disadvantage on the first d20, a target to beat, and the
// natural 20 / natural 1 calls. Parses text, never evaluates it.
import { randomDie, type Die } from '@/engines/character-sheets/mechanics';

export interface DiceTerm { sign: 1 | -1; count: number; sides: number; keep?: { highest: boolean; amount: number }; rolls: number[]; kept: boolean[] }
export type DiceMode = 'normal' | 'advantage' | 'disadvantage';
export interface DiceRoll {
  id: string; at: number; expression: string; label?: string; mode: DiceMode;
  terms: DiceTerm[]; modifier: number; total: number;
  /** A lone kept d20 that came up 20 or 1. */
  natural?: 20 | 1;
  target?: number; outcome?: 'pass' | 'miss';
}

const TERM = /^(\d*)d(\d+|%)(?:(kh|kl)(\d+))?$/;
export const DICE_LIMITS = { expression: 80, terms: 12, dice: 100, sides: 1000 } as const;

/** Read "2d6 + 1d8 - 1", "4d6kh3", "d%" into terms; throws `invalid_expression` or `dice_limit`. */
export function parseDice(expression: string): { terms: Omit<DiceTerm, 'rolls' | 'kept'>[]; modifier: number } {
  const clean = expression.replace(/\s+/g, '').replace(/−/g, '-').toLowerCase();
  if (!clean || clean.length > DICE_LIMITS.expression) throw new Error('invalid_expression');
  const parts = clean.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== clean || parts.length > DICE_LIMITS.terms) throw new Error('invalid_expression');
  const terms: Omit<DiceTerm, 'rolls' | 'kept'>[] = []; let modifier = 0, dice = 0;
  for (const part of parts) {
    const sign = part.startsWith('-') ? -1 : 1, body = part.replace(/^[+-]/, '');
    const match = TERM.exec(body);
    if (!match) { if (!/^\d{1,6}$/.test(body)) throw new Error('invalid_expression'); modifier += sign * Number(body); continue; }
    const count = match[1] ? Number(match[1]) : 1, sides = match[2] === '%' ? 100 : Number(match[2]);
    if (count < 1 || sides < 2 || sides > DICE_LIMITS.sides) throw new Error('dice_limit');
    dice += count; if (dice > DICE_LIMITS.dice) throw new Error('dice_limit');
    const keep = match[3] ? { highest: match[3] === 'kh', amount: Number(match[4]) } : undefined;
    if (keep && (keep.amount < 1 || keep.amount > count)) throw new Error('invalid_expression');
    terms.push({ sign, count, sides, ...(keep ? { keep } : {}) });
  }
  return { terms, modifier };
}

function keptFlags(rolls: number[], keep?: DiceTerm['keep']): boolean[] {
  if (!keep) return rolls.map(() => true);
  const order = rolls.map((value, index) => ({ value, index })).sort((a, b) => keep.highest ? b.value - a.value || a.index - b.index : a.value - b.value || a.index - b.index);
  const chosen = new Set(order.slice(0, keep.amount).map(item => item.index));
  return rolls.map((_, index) => chosen.has(index));
}

/** Roll an expression. Advantage/disadvantage turn the first single d20 into 2d20 keeping the higher/lower. */
export function rollDice(expression: string, options: { mode?: DiceMode; target?: number; label?: string; die?: Die; now?: number } = {}): DiceRoll {
  const { terms, modifier } = parseDice(expression), die = options.die ?? randomDie, mode = options.mode ?? 'normal';
  let adjusted = false;
  const rolled: DiceTerm[] = terms.map(term => {
    let shaped = term;
    if (mode !== 'normal' && !adjusted && term.sides === 20 && term.count === 1 && !term.keep) { adjusted = true; shaped = { ...term, count: 2, keep: { highest: mode === 'advantage', amount: 1 } }; }
    const rolls = Array.from({ length: shaped.count }, () => die(shaped.sides));
    return { ...shaped, rolls, kept: keptFlags(rolls, shaped.keep) };
  });
  const total = rolled.reduce((sum, term) => sum + term.sign * term.rolls.reduce((acc, value, index) => acc + (term.kept[index] ? value : 0), 0), 0) + modifier;
  const d20s = rolled.filter(term => term.sides === 20).flatMap(term => term.rolls.filter((_, index) => term.kept[index]));
  const natural = d20s.length === 1 && (d20s[0] === 20 || d20s[0] === 1) ? d20s[0] as 20 | 1 : undefined;
  const target = options.target !== undefined && Number.isFinite(options.target) ? Math.round(options.target) : undefined;
  const outcome = target === undefined ? undefined : natural === 20 ? 'pass' : natural === 1 ? 'miss' : total >= target ? 'pass' : 'miss';
  return { id: crypto.randomUUID(), at: options.now ?? Date.now(), expression: expression.trim(), ...(options.label?.trim() ? { label: options.label.trim().slice(0, 80) } : {}), mode, terms: rolled, modifier, total, ...(natural ? { natural } : {}), ...(target !== undefined ? { target, outcome } : {}) };
}

/** "d20 (↑ 17, 4) + 5 = 22" — the roll written out for a log, a chapter or a tool result. */
export function describeRoll(roll: DiceRoll): string {
  const parts = roll.terms.map((term, index) => {
    const faces = term.rolls.map((value, i) => term.kept[i] ? String(value) : `~~${value}~~`).join(', ');
    const name = `${term.keep && roll.mode !== 'normal' && term.sides === 20 && term.count === 2 ? (term.keep.highest ? '↑' : '↓') : ''}${term.count}d${term.sides}${term.keep && !(roll.mode !== 'normal' && term.count === 2 && term.sides === 20) ? `${term.keep.highest ? 'kh' : 'kl'}${term.keep.amount}` : ''}`;
    return `${index || term.sign < 0 ? (term.sign < 0 ? '− ' : '+ ') : ''}${name} [${faces}]`;
  });
  if (roll.modifier) parts.push(`${roll.modifier < 0 ? '−' : '+'} ${Math.abs(roll.modifier)}`);
  return `${parts.join(' ')} = ${roll.total}`;
}

/** Add one die to a tray expression: "1d20" + d6 → "1d20+1d6"; another d6 → "1d20+2d6". */
export function addDie(expression: string, sides: number): string {
  const clean = expression.replace(/\s+/g, '');
  const pattern = new RegExp(`(^|[+-])(\\d*)d${sides}(?![\\d%k])`);
  const match = pattern.exec(clean);
  if (match) return clean.replace(pattern, `${match[1]}${(Number(match[2] || 1) + 1)}d${sides}`);
  const modifier = /([+-]\d+)$/.exec(clean)?.[1] ?? '';
  const dice = modifier ? clean.slice(0, -modifier.length) : clean;
  return `${dice ? `${dice}+` : ''}1d${sides}${modifier}`;
}

/** Change the flat modifier at the end of an expression by `delta`. */
export function nudgeModifier(expression: string, delta: number): string {
  const clean = expression.replace(/\s+/g, '');
  const match = /([+-]\d+)$/.exec(clean), current = match ? Number(match[1]) : 0;
  const dice = match ? clean.slice(0, -match[1].length) : clean, next = current + delta;
  return `${dice}${next ? (next > 0 ? `+${next}` : String(next)) : ''}` || '1d20';
}

export const DICE_SETS = ['black', 'bone', 'brass', 'seaglass', 'oxblood', 'world'] as const;
export type DiceSet = typeof DICE_SETS[number];
/** Face, ink and edge colours of each set; "world" takes the project's colour. */
export function diceSetColours(set: DiceSet, worldColour = '#d5b575'): { face: string; ink: string; edge: string } {
  switch (set) {
    case 'bone': return { face: '#efe6d2', ink: '#3b2f22', edge: '#bfae8c' };
    case 'brass': return { face: '#c9a24a', ink: '#2b1f08', edge: '#8a6a22' };
    case 'seaglass': return { face: '#9fd3c7', ink: '#123c37', edge: '#5fa597' };
    case 'oxblood': return { face: '#6b1420', ink: '#f6e3c5', edge: '#3e0a12' };
    case 'world': return { face: worldColour, ink: '#14110c', edge: '#00000055' };
    default: return { face: '#1d1d21', ink: '#f2f2f2', edge: '#4a4a52' };
  }
}
