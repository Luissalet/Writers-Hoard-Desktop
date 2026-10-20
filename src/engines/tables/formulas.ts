import { cellKey, type WorldTable } from './types';

export type CellValue = string | number;
const error = (message: string): never => { throw new Error(message); };

/** A small, deterministic formula interpreter. Never executes JavaScript or fetches. */
export function sheetValues(table: WorldTable): Map<string, CellValue> {
  const raw = new Map<string, string>();
  table.rows.forEach((row, rowIndex) => table.columns.forEach((column, columnIndex) => raw.set(cellKey(columnIndex, rowIndex), row.cells[column.id] ?? '')));
  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();
  let budget = 100000;
  const numeric = (value: CellValue) => value === '' ? 0 : typeof value === 'number' ? value : /^#[A-Z0-9/]+!$/.test(value) ? error(value) : Number.isFinite(Number(value)) ? Number(value) : error('#VALUE!');
  const read = (key: string): CellValue => {
    if (--budget < 0) return error('#LIMIT!');
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) return error('#CYCLE!');
    if (visiting.size > 100) return error('#DEPTH!');
    const source = raw.get(key);
    if (source === undefined) return error('#REF!');
    visiting.add(key);
    try {
      const result = source.startsWith('=') ? evaluate(source.slice(1), read) : source.trim() !== '' && Number.isFinite(Number(source)) ? Number(source) : source;
      if (typeof result === 'number' && !Number.isFinite(result)) return error('#NUM!');
      cache.set(key, result); return result;
    } finally { visiting.delete(key); }
  };
  const evaluate = (source: string, lookup: (key: string) => CellValue): number => {
    if (source.length > 4000) return error('#LIMIT!');
    const tokens = source.toUpperCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Z]+\d+|[A-Z]+|[+\-*/^(),:]/g) ?? [];
    if (tokens.join('') !== source.replace(/\s+/g, '').toUpperCase()) return error('#FORMULA!');
    let index = 0;
    const take = () => tokens[index++];
    const reference = (token: string) => /^[A-Z]+[1-9]\d*$/.test(token);
    const parsePosition = (token: string) => {
      const match = /^([A-Z]+)([1-9]\d*)$/.exec(token); if (!match) return error('#REF!');
      let column = 0; for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
      return { column: column - 1, row: Number(match[2]) - 1 };
    };
    let depth = 0;
    const primary = (): number => {
      if (++depth > 100) return error('#DEPTH!');
      try {
        const token = take();
        if (token === '(') { const value = expression(); if (take() !== ')') return error('#FORMULA!'); return value; }
        if (token && /^(?:\d|\.)/.test(token)) return Number(token);
        if (token && reference(token)) return numeric(lookup(token));
        if (!token || !['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'ABS', 'ROUND'].includes(token) || take() !== '(') return error('#FORMULA!');
        const values: number[] = [];
        if (tokens[index] !== ')') {
          do {
            if (reference(tokens[index] ?? '') && tokens[index + 1] === ':') {
              const from = parsePosition(take()); take(); const to = parsePosition(take());
              if (Math.abs(to.column - from.column) * Math.abs(to.row - from.row) > 20000) return error('#LIMIT!');
              for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
                for (let column = Math.min(from.column, to.column); column <= Math.max(from.column, to.column); column++) {
                  if (values.length >= 20000) return error('#LIMIT!');
                  const value = lookup(cellKey(column, row));
                  if (typeof value === 'number' || value !== '' && Number.isFinite(Number(value))) values.push(numeric(value));
                }
              }
            } else values.push(expression());
            if (tokens[index] !== ',') break;
            take();
          } while (index < tokens.length);
        }
        if (take() !== ')') return error('#FORMULA!');
        if (token === 'COUNT') return values.length;
        if (!values.length) return token === 'SUM' ? 0 : error('#VALUE!');
        if (token === 'SUM') return values.reduce((sum, value) => sum + value, 0);
        if (token === 'AVG' || token === 'AVERAGE') return values.reduce((sum, value) => sum + value, 0) / values.length;
        if (token === 'MIN') return Math.min(...values);
        if (token === 'MAX') return Math.max(...values);
        if (token === 'ABS') return values.length === 1 ? Math.abs(values[0]) : error('#FORMULA!');
        if (values.length > 2 || !Number.isInteger(values[1] ?? 0) || Math.abs(values[1] ?? 0) > 12) return error('#FORMULA!');
        const factor = 10 ** (values[1] ?? 0); return Math.round(values[0] * factor) / factor;
      } finally { depth--; }
    };
    let powerDepth = 0;
    const power = (): number => { const left = primary(); if (tokens[index] !== '^') return left; if (++powerDepth > 100) return error('#DEPTH!'); try { take(); return left ** unary(); } finally { powerDepth--; } };
    const unary = (): number => { if (tokens[index] !== '+' && tokens[index] !== '-') return power(); if (++powerDepth > 100) return error('#DEPTH!'); try { return take() === '-' ? -unary() : unary(); } finally { powerDepth--; } };
    const multiply = (): number => { let value = unary(); while (tokens[index] === '*' || tokens[index] === '/') { const operator = take(); const right = unary(); if (operator === '/' && right === 0) return error('#DIV/0!'); value = operator === '*' ? value * right : value / right; } return value; };
    const expression = (): number => { let value = multiply(); while (tokens[index] === '+' || tokens[index] === '-') { const operator = take(); const right = multiply(); value = operator === '+' ? value + right : value - right; } return value; };
    const value = expression();
    return index === tokens.length ? value : error('#FORMULA!');
  };
  for (const key of raw.keys()) { try { read(key); } catch (reason) { cache.set(key, reason instanceof Error ? reason.message : '#ERROR!'); } }
  return cache;
}
