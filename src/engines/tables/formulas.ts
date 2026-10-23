import { cellKey, type WorldTable } from './types';

export type CellValue = string | number;
type Value = string | number | boolean;
type Arg = { range: CellValue[][] } | { value: Value };
const error = (message: string): never => { throw new Error(message); };
const ERRORS = new Set(['#VALUE!', '#REF!', '#DIV/0!', '#NUM!', '#N/A', '#CYCLE!', '#DEPTH!', '#LIMIT!', '#FORMULA!', '#ERROR!', '#NAME?']);
/** An arithmetic result Excel could not show: a division by zero when `zero`, otherwise #NUM!. */
const finite = (value: number, zero = false): number => Number.isFinite(value) ? value : error(zero ? '#DIV/0!' : '#NUM!');
/** x^y as Excel gives it: 0 to a negative power divides by zero; other results out of range are #NUM!. */
const power2 = (base: number, exponent: number): number => base === 0 && exponent < 0 ? error('#DIV/0!') : finite(base ** exponent);
const isError = (value: unknown): boolean => typeof value === 'string' && ERRORS.has(value);

/** Spanish names (as a Spanish spreadsheet writes them) for the same functions. */
const ALIASES: Record<string, string> = {
  SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', SI: 'IF', Y: 'AND', O: 'OR', NO: 'NOT', 'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF',
  'PROMEDIO.SI': 'AVERAGEIF', BUSCARV: 'VLOOKUP', CONCATENAR: 'CONCAT', CONCATENATE: 'CONCAT', LARGO: 'LEN', MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM',
  REDONDEAR: 'ROUND', 'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN', MEDIANA: 'MEDIAN', RESIDUO: 'MOD', POTENCIA: 'POWER', RAIZ: 'SQRT', ENTERO: 'INT',
  'SI.ERROR': 'IFERROR', SUMAPRODUCTO: 'SUMPRODUCT', 'MULTIPLO.INFERIOR': 'FLOOR', 'MULTIPLO.SUPERIOR': 'CEILING', VERDADERO: 'TRUE', FALSO: 'FALSE',
};
export const SHEET_FUNCTIONS = ['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'MEDIAN', 'ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'MOD', 'POWER', 'SQRT', 'FLOOR', 'CEILING', 'SUMPRODUCT', 'IF', 'IFERROR', 'AND', 'OR', 'NOT', 'SUMIF', 'COUNTIF', 'AVERAGEIF', 'VLOOKUP', 'CONCAT', 'LEN', 'UPPER', 'LOWER', 'TRIM'] as const;
const FUNCTIONS = new Set<string>(SHEET_FUNCTIONS);

// Numbers may end in % (10% is 0.1); A:A is a whole column.
const TOKEN = /\s*(?:("(?:[^"]|"")*")|((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?)|(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![A-Za-z0-9.(])|(\$?[A-Za-z]+\$?[1-9]\d*)(?![A-Za-z0-9.])|([A-Za-z][A-Za-z0-9.]*)|(<>|<=|>=|[+\-*/^(),:;&=<>]))/y;
type Token = { kind: 'string' | 'number' | 'column' | 'ref' | 'name' | 'op'; text: string };
function tokenize(source: string): Token[] {
  const out: Token[] = []; TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex, match = TOKEN.exec(source);
    if (!match || TOKEN.lastIndex === at) return error('#FORMULA!');
    if (match[1] !== undefined) out.push({ kind: 'string', text: match[1].slice(1, -1).replace(/""/g, '"') });
    else if (match[2] !== undefined) out.push({ kind: 'number', text: match[2] });
    else if (match[3] !== undefined) out.push({ kind: 'column', text: match[3].replace(/\$/g, '').toUpperCase() });
    else if (match[4] !== undefined) out.push({ kind: 'ref', text: match[4].replace(/\$/g, '').toUpperCase() });
    else if (match[5] !== undefined) out.push({ kind: 'name', text: match[5].toUpperCase() });
    else out.push({ kind: 'op', text: match[6] });
    if (out.length > 2000) return error('#LIMIT!');
  }
  return out;
}

const numberOf = (value: Value | CellValue): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === '') return 0;
  if (isError(value)) return error(value);
  if (value === 'TRUE' || value === 'FALSE') return value === 'TRUE' ? 1 : 0;
  return Number.isFinite(Number(value)) ? Number(value) : error('#VALUE!');
};
const textOf = (value: Value | CellValue): string => { if (isError(value)) return error(String(value)); return typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value); };
const truthOf = (value: Value | CellValue): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && (value.toUpperCase() === 'TRUE' || value.toUpperCase() === 'FALSE')) return value.toUpperCase() === 'TRUE';
  return numberOf(value) !== 0;
};
const isNumeric = (value: CellValue | Value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
function compare(left: Value | CellValue, right: Value | CellValue): number {
  if (isNumeric(left) && isNumeric(right)) return numberOf(left) - numberOf(right);
  const a = textOf(left).toLocaleLowerCase(), b = textOf(right).toLocaleLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}
/** A SUMIF/COUNTIF criterion: ">10", "<>x", "=Puerto", "Puerto" or a number. */
function criterion(raw: Value): (value: CellValue) => boolean {
  const text = textOf(raw), match = /^(<>|<=|>=|=|<|>)?(.*)$/s.exec(text)!, operator = match[1] ?? '=', target: Value = match[2];
  return value => {
    if (isError(value)) return false;
    if (operator === '=' && target === '') return value === '';
    const order = isNumeric(target) && isNumeric(value) ? numberOf(value) - numberOf(target) : (isNumeric(target) !== isNumeric(value) && operator !== '<>' && operator !== '=') ? NaN : compare(value, target);
    if (Number.isNaN(order)) return false;
    return operator === '=' ? order === 0 : operator === '<>' ? order !== 0 : operator === '<' ? order < 0 : operator === '>' ? order > 0 : operator === '<=' ? order <= 0 : order >= 0;
  };
}

/** A small, deterministic formula interpreter. Never executes JavaScript or fetches. */
export function sheetValues(table: WorldTable): Map<string, CellValue> {
  const raw = new Map<string, string>();
  table.rows.forEach((row, rowIndex) => table.columns.forEach((column, columnIndex) => raw.set(cellKey(columnIndex, rowIndex), row.cells[column.id] ?? '')));
  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();
  let budget = 100000;
  const read = (key: string): CellValue => {
    if (--budget < 0) return error('#LIMIT!');
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) return error('#CYCLE!');
    if (visiting.size > 100) return error('#DEPTH!');
    const source = raw.get(key);
    if (source === undefined) return error('#REF!');
    visiting.add(key);
    try {
      let result: CellValue;
      if (source.startsWith('=')) { const value = evaluate(source.slice(1), read); result = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value; }
      else result = source.trim() !== '' && Number.isFinite(Number(source)) ? Number(source) : source;
      if (typeof result === 'number' && !Number.isFinite(result)) return error('#NUM!');
      cache.set(key, result); return result;
    } finally { visiting.delete(key); }
  };
  const evaluate = (source: string, lookup: (key: string) => CellValue): Value => {
    if (source.length > 4000) return error('#LIMIT!');
    const tokens = tokenize(source);
    let index = 0, depth = 0;
    const peek = (offset = 0) => tokens[index + offset];
    const isOp = (text: string, offset = 0) => peek(offset)?.kind === 'op' && peek(offset)!.text === text;
    const take = () => tokens[index++];
    const position = (token: string) => {
      const match = /^([A-Z]+)([1-9]\d*)$/.exec(token); if (!match) return error('#REF!');
      let column = 0; for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
      return { column: column - 1, row: Number(match[2]) - 1 };
    };
    const range = (fromToken: string, toToken: string): CellValue[][] => {
      const from = position(fromToken), to = position(toToken);
      if ((Math.abs(to.column - from.column) + 1) * (Math.abs(to.row - from.row) + 1) > 20000) return error('#LIMIT!');
      const rows: CellValue[][] = [];
      for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
        const line: CellValue[] = [];
        for (let column = Math.min(from.column, to.column); column <= Math.max(from.column, to.column); column++) { try { line.push(lookup(cellKey(column, row))); } catch (reason) { line.push(reason instanceof Error ? reason.message : '#ERROR!'); } }
        rows.push(line);
      }
      return rows;
    };
    // A whole column covers the sheet's rows (and nothing past them); a column the sheet does not have is empty.
    const columnRange = (token: string): CellValue[][] => {
      const [fromLetters, toLetters] = token.split(':'), letters = (text: string) => { let column = 0; for (const char of text) column = column * 26 + char.charCodeAt(0) - 64; return column - 1; };
      const from = Math.min(letters(fromLetters), letters(toLetters)), to = Math.max(letters(fromLetters), letters(toLetters));
      if ((to - from + 1) * table.rows.length > 20000) return error('#LIMIT!');
      return table.rows.map((_, row) => { const line: CellValue[] = []; for (let column = from; column <= to; column++) { if (column >= table.columns.length) { line.push(''); continue; } try { line.push(lookup(cellKey(column, row))); } catch (reason) { line.push(reason instanceof Error ? reason.message : '#ERROR!'); } } return line; });
    };
    const guarded = <T,>(run: () => T): T => { if (++depth > 100) return error('#DEPTH!'); try { return run(); } finally { depth--; } };
    const primary = (): Value => guarded(() => {
      const token = take();
      if (!token) return error('#FORMULA!');
      if (token.kind === 'op' && token.text === '(') { const value = comparison(); if (!isOp(')')) return error('#FORMULA!'); take(); return value; }
      if (token.kind === 'number') return token.text.endsWith('%') ? Number(token.text.slice(0, -1)) / 100 : Number(token.text);
      if (token.kind === 'string') return token.text;
      if (token.kind === 'ref') return lookup(token.text);
      if (token.kind !== 'name') return error('#FORMULA!');
      const name = ALIASES[token.text] ?? token.text;
      if ((name === 'TRUE' || name === 'FALSE') && !isOp('(')) return name === 'TRUE';
      if (!FUNCTIONS.has(name) || !isOp('(')) return error('#FORMULA!');
      take();
      return call(name);
    });
    // Arguments are parsed lazily so IF and IFERROR only evaluate the branch they take.
    const argumentSpans = (): [number, number][] => {
      const spans: [number, number][] = []; let start = index, level = 0;
      if (isOp(')')) { take(); return spans; }
      for (;;) {
        const token = take(); if (!token) return error('#FORMULA!');
        if (token.kind === 'op' && token.text === '(') level++;
        else if (token.kind === 'op' && token.text === ')') { if (!level) { spans.push([start, index - 1]); return spans; } level--; }
        else if (token.kind === 'op' && (token.text === ',' || token.text === ';') && !level) { spans.push([start, index - 1]); start = index; }
        if (spans.length > 255) return error('#LIMIT!');
      }
    };
    const evalSpan = ([start, end]: [number, number]): Arg => {
      const saved = index; index = start;
      try {
        if (end - start === 3 && peek()?.kind === 'ref' && isOp(':', 1) && peek(2)?.kind === 'ref') return { range: range(tokens[start].text, tokens[start + 2].text) };
        if (end - start === 1 && peek()?.kind === 'column') return { range: columnRange(tokens[start].text) };
        if (end === start) return error('#FORMULA!');
        const value = comparison();
        if (index !== end) return error('#FORMULA!');
        return { value };
      } finally { index = saved; }
    };
    const call = (name: string): Value => {
      const spans = argumentSpans(), after = index;
      const arg = (n: number) => { if (!spans[n]) return error('#FORMULA!'); const result = evalSpan(spans[n]); index = after; return result; };
      const scalar = (n: number): Value => { const a = arg(n); return 'value' in a ? a.value : a.range.length === 1 && a.range[0].length === 1 ? a.range[0][0] : error('#VALUE!'); };
      const grid = (n: number): CellValue[][] => { const a = arg(n); return 'range' in a ? a.range : [[a.value as CellValue]]; };
      const count = (min: number, max: number) => { if (spans.length < min || spans.length > max) error('#FORMULA!'); };
      // Every argument's numbers: ranges skip text and blanks (as spreadsheets do); a direct argument must be a number.
      const numbers = (): number[] => {
        const out: number[] = [];
        for (let n = 0; n < spans.length; n++) {
          const a = arg(n);
          if ('range' in a) { for (const value of a.range.flat()) { if (isError(value)) error(String(value)); if (isNumeric(value)) out.push(numberOf(value)); if (out.length > 20000) error('#LIMIT!'); } }
          else out.push(numberOf(a.value));
        }
        return out;
      };
      switch (name) {
        case 'SUM': return numbers().reduce((sum, value) => sum + value, 0);
        case 'AVG': case 'AVERAGE': { const values = numbers(); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : error('#VALUE!'); }
        case 'MIN': case 'MAX': { const values = numbers(); return values.length ? (name === 'MIN' ? Math.min(...values) : Math.max(...values)) : error('#VALUE!'); }
        case 'COUNT': { let total = 0; for (let n = 0; n < spans.length; n++) { const a = arg(n); total += 'range' in a ? a.range.flat().filter(isNumeric).length : isNumeric(a.value) ? 1 : 0; } return total; }
        case 'COUNTA': { let total = 0; for (let n = 0; n < spans.length; n++) { const a = arg(n); total += 'range' in a ? a.range.flat().filter(value => value !== '').length : a.value !== '' ? 1 : 0; } return total; }
        case 'MEDIAN': { const values = numbers().sort((a, b) => a - b); if (!values.length) return error('#VALUE!'); const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; }
        case 'ABS': count(1, 1); return Math.abs(numberOf(scalar(0)));
        case 'INT': count(1, 1); return Math.floor(numberOf(scalar(0)));
        case 'SQRT': { count(1, 1); const value = numberOf(scalar(0)); return value < 0 ? error('#NUM!') : Math.sqrt(value); }
        case 'MOD': { count(2, 2); const divisor = numberOf(scalar(1)); if (divisor === 0) return error('#DIV/0!'); const value = numberOf(scalar(0)); return value - divisor * Math.floor(value / divisor); }
        case 'POWER': count(2, 2); return power2(numberOf(scalar(0)), numberOf(scalar(1)));
        case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
          count(1, 2); const value = numberOf(scalar(0)), digits = spans.length > 1 ? numberOf(scalar(1)) : 0;
          if (!Number.isInteger(digits) || Math.abs(digits) > 12) return error('#FORMULA!');
          const factor = 10 ** digits, scaled = value * factor;
          const rounded = name === 'ROUND' ? Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9) : name === 'ROUNDUP' ? Math.sign(scaled) * Math.ceil(Math.abs(scaled) - 1e-9) : Math.sign(scaled) * Math.floor(Math.abs(scaled) + 1e-9);
          return rounded / factor;
        }
        case 'FLOOR': case 'CEILING': { count(1, 2); const value = numberOf(scalar(0)), step = spans.length > 1 ? numberOf(scalar(1)) : 1; if (step === 0) return 0; return (name === 'FLOOR' ? Math.floor(value / step) : Math.ceil(value / step)) * step; }
        case 'SUMPRODUCT': {
          count(1, 30); const lists = spans.map((_, n) => grid(n)), rows = lists[0].length, columns = lists[0][0]?.length ?? 0;
          if (lists.some(list => list.length !== rows || (list[0]?.length ?? 0) !== columns)) return error('#VALUE!');
          let total = 0;
          for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { let product = 1; for (const list of lists) { const cell = list[r][c]; if (isError(cell)) error(String(cell)); product *= isNumeric(cell) ? numberOf(cell) : 0; } total += product; }
          return finite(total);
        }
        case 'IF': { count(2, 3); return truthOf(scalar(0)) ? scalar(1) : spans.length > 2 ? scalar(2) : false; }
        case 'IFERROR': { count(2, 2); try { const value = scalar(0); return isError(value) ? scalar(1) : value; } catch (reason) { if (reason instanceof Error && isError(reason.message)) return scalar(1); throw reason; } }
        case 'AND': case 'OR': { if (!spans.length) return error('#FORMULA!'); const values: boolean[] = []; for (let n = 0; n < spans.length; n++) { const a = arg(n); if ('range' in a) values.push(...a.range.flat().filter(value => value !== '').map(truthOf)); else values.push(truthOf(a.value)); } return name === 'AND' ? values.every(Boolean) : values.some(Boolean); }
        case 'NOT': count(1, 1); return !truthOf(scalar(0));
        case 'SUMIF': case 'COUNTIF': case 'AVERAGEIF': {
          count(2, name === 'COUNTIF' ? 2 : 3);
          const tested = grid(0).flat(), test = criterion(scalar(1)), summed = spans.length > 2 ? grid(2).flat() : tested;
          const matches = tested.map((value, i) => test(value) ? i : -1).filter(i => i >= 0);
          if (name === 'COUNTIF') return matches.length;
          const values = matches.map(i => summed[i]).filter(value => value !== undefined && isNumeric(value)).map(numberOf);
          if (name === 'SUMIF') return values.reduce((sum, value) => sum + value, 0);
          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : error('#DIV/0!');
        }
        case 'VLOOKUP': {
          count(3, 4); const key = scalar(0), rows = grid(1), column = numberOf(scalar(2)), approximate = spans.length > 3 ? truthOf(scalar(3)) : false;
          if (!Number.isInteger(column) || column < 1 || column > (rows[0]?.length ?? 0)) return error('#REF!');
          if (!approximate) { const found = rows.find(row => !isError(row[0]) && row[0] !== '' && compare(row[0], key) === 0); return found ? found[column - 1] : error('#N/A'); }
          let best: CellValue[] | undefined; for (const row of rows) { if (row[0] === '' || isError(row[0])) continue; if (compare(row[0], key) <= 0) best = row; else break; }
          return best ? best[column - 1] : error('#N/A');
        }
        case 'CONCAT': { let out = ''; for (let n = 0; n < spans.length; n++) { const a = arg(n); out += 'range' in a ? a.range.flat().map(textOf).join('') : textOf(a.value); if (out.length > 10000) return error('#LIMIT!'); } return out; }
        case 'LEN': count(1, 1); return textOf(scalar(0)).length;
        case 'UPPER': count(1, 1); return textOf(scalar(0)).toLocaleUpperCase();
        case 'LOWER': count(1, 1); return textOf(scalar(0)).toLocaleLowerCase();
        case 'TRIM': count(1, 1); return textOf(scalar(0)).trim().replace(/\s+/g, ' ');
      }
      return error('#FORMULA!');
    };
    let powerDepth = 0;
    const power = (): Value => { const left = primary(); if (!isOp('^')) return left; if (++powerDepth > 100) return error('#DEPTH!'); try { take(); return power2(numberOf(left), numberOf(unary())); } finally { powerDepth--; } };
    const unary = (): Value => { if (!isOp('+') && !isOp('-')) return power(); if (++powerDepth > 100) return error('#DEPTH!'); try { return take().text === '-' ? -numberOf(unary()) : numberOf(unary()); } finally { powerDepth--; } };
    const multiply = (): Value => { let value = unary(); while (isOp('*') || isOp('/')) { const operator = take().text; const right = numberOf(unary()); if (operator === '/' && right === 0) return error('#DIV/0!'); value = finite(operator === '*' ? numberOf(value) * right : numberOf(value) / right); } return value; };
    const additive = (): Value => { let value = multiply(); while (isOp('+') || isOp('-')) { const operator = take().text; const right = numberOf(multiply()); value = finite(operator === '+' ? numberOf(value) + right : numberOf(value) - right); } return value; };
    const concat = (): Value => { let value = additive(); while (isOp('&')) { take(); value = textOf(value) + textOf(additive()); if ((value as string).length > 10000) return error('#LIMIT!'); } return value; };
    const comparison = (): Value => {
      let value = concat();
      while (['=', '<>', '<', '>', '<=', '>='].some(op => isOp(op))) {
        const operator = take().text, right = concat(), order = compare(value, right);
        value = operator === '=' ? order === 0 : operator === '<>' ? order !== 0 : operator === '<' ? order < 0 : operator === '>' ? order > 0 : operator === '<=' ? order <= 0 : order >= 0;
      }
      return value;
    };
    const value = comparison();
    return index === tokens.length ? value : error('#FORMULA!');
  };
  for (const key of raw.keys()) { try { read(key); } catch (reason) { cache.set(key, reason instanceof Error ? reason.message : '#ERROR!'); } }
  return cache;
}
