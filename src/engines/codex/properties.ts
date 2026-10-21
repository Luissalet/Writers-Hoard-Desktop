import type { CodexEntry } from '@/types';
import type { CalculationResultType, CodexPropertyDefinition, CodexTemplate } from './templateTypes';
import { effectiveCodexTemplate } from './templateHierarchy';
import { foldAlias } from '@/services/codexReference/aliases';

export interface ProjectedPropertyOption { value: string; color?: string; ink?: string }
export interface ProjectedProperty { label: string; value: string; displayValue?: string; status: 'value' | 'empty' | 'error'; error?: string; calculated: boolean; options?: ProjectedPropertyOption[] }
/** Black/white chosen by relative luminance guarantees at least4.5:1 on solid color. */
export function codexOptionAppearance(definition:CodexPropertyDefinition,value:string):ProjectedPropertyOption {
  const color=definition.optionColors?.[value];
  if(!color||!/^#[\da-f]{6}$/i.test(color))return{value};
  const linear=[1,3,5].map(index=>{const channel=parseInt(color.slice(index,index+2),16)/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});
  const luminance=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
  return{value,color,ink:(luminance+.05)/.05>=1.05/(luminance+.05)?'#000000':'#ffffff'};
}
/** Portable content markup for consumers; fields remain a plain-text projection. */
export function codexPropertyHtml(property:ProjectedProperty):string {
  const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  if(!property.options)return escape(property.displayValue??property.value);
  return property.options.map(option=>{
    const color=option.color&&/^#[\da-f]{6}$/i.test(option.color)?option.color:undefined;
    const ink=option.ink==='#000000'||option.ink==='#ffffff'?option.ink:undefined;
    return `<span data-wh-property-option="true" style="display:inline-block;margin:2px 4px 2px 0;padding:2px 9px;border:1px solid currentColor;border-radius:999px;overflow-wrap:anywhere${color&&ink?`;background-color:${color};color:${ink}`:''}">${escape(option.value)}</span>`;
  }).join('');
}
export type FormulaValue = string | number | boolean;
type Value = FormulaValue;
export type FormulaNode = { value: Value } | { ref: string } | { column: string } | { op: string; args: FormulaNode[] };
type Node = FormulaNode;
const fail = (code: string): never => { throw new Error(code); };
const number = (value: Value): number => typeof value === 'boolean' || typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value)) ? fail('#VALUE!') : Number(value);

/** Parse into inert nodes so IF/IFS evaluate only their selected branch. */
export function parsePropertyFormula(source: string, bindings: Record<string, string>, columns?: Record<string,string>): Node {
  const tokens = source.replace(/^\s*=/, '').match(/@\[[^\]]+\]|\[[^\]]+\]|"(?:[^"\\]|\\.)*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*|<=|>=|<>|!=|[+\-*/^&=<>(),]/gu) ?? [];
  // Remove whitespace only outside quoted strings and property references.
  let compact = '', quoted = false, referenced = false, escaped = false;
  for (const char of source.replace(/^\s*=/, '')) { if (char === '"' && !escaped && !referenced) quoted = !quoted; if (char === '[' && !quoted) referenced = true; if (!/\s/.test(char) || quoted || referenced) compact += char; if (char === ']' && !quoted) referenced = false; escaped = char === '\\' && !escaped; }
  if (tokens.join('') !== compact) fail('#FORMULA!');
  let at = 0;
  const primary = (): Node => {
    const token = tokens[at++];
    if (!token) return fail('#FORMULA!');
    if (token === '(') { const node = comparison(); if (tokens[at++] !== ')') fail('#FORMULA!'); return node; }
    if (token.startsWith('@[')) return { ref: bindings[token.slice(2, -1)] ?? fail('#REF!') };
    if (token.startsWith('"')) { try { return { value: JSON.parse(token) as string }; } catch { return fail('#FORMULA!'); } }
    if (/^(?:\d|\.)/.test(token)) return { value: Number(token) };
    if (/^(TRUE|FALSE)$/i.test(token) && tokens[at] !== '(') return { value: token.toUpperCase() === 'TRUE' };
    if (tokens[at] !== '(') return columns?{column:columns[token.startsWith('[')?token.slice(1,-1):token]??`missing:${token}`} : fail('#NAME?');
    at++;
    const args: Node[] = [];
    if (tokens[at] !== ')') do { args.push(comparison()); if (tokens[at] !== ',') break; at++; } while (at < tokens.length);
    if (tokens[at++] !== ')') fail('#FORMULA!');
    return { op: token.toUpperCase(), args };
  };
  const power = (): Node => { const left = primary(); return tokens[at] === '^' ? (at++, { op: '^', args: [left, unary()] }) : left; };
  const unary = (): Node => tokens[at] === '+' || tokens[at] === '-' ? { op: tokens[at++] === '-' ? 'NEGATE' : 'POSITIVE', args: [unary()] } : power();
  const binary = (next: () => Node, operators: string[]) => { let node = next(); while (operators.includes(tokens[at])) node = { op: tokens[at++], args: [node, next()] }; return node; };
  const multiply = (): Node => binary(unary, ['*', '/']);
  const sum = (): Node => binary(multiply, ['+', '-', '&']);
  const comparison = (): Node => binary(sum, ['=', '<>', '!=', '<', '>', '<=', '>=']);
  const node = comparison(); if (at !== tokens.length) fail('#FORMULA!'); return node;
}

export function evaluatePropertyFormula(node: Node, read: (id: string) => Value, readColumn?: (id:string)=>Value[], aggregateMemo?:Map<FormulaNode,Value>): Value {
  if ('value' in node) return node.value;
  if ('ref' in node) return read(node.ref);
  if ('column' in node) return fail('#VALUE!');
  const { op, args } = node;
  if(aggregateMemo&&['SUM','AVERAGE','AVG','COUNT','MIN','MAX'].includes(op)&&!propertyFormulaDependencies(node).rows.size){if(aggregateMemo.has(node))return aggregateMemo.get(node)!;const value=evaluatePropertyFormula(node,read,readColumn);aggregateMemo.set(node,value);return value;}
  if (!['IF', 'IFS', '&', 'CONCATENATE', 'CONCAT', 'UPPER', 'LOWER', 'TRIM', 'LEN', 'NOT', 'AND', 'OR', '=', '<>', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '^', 'NEGATE', 'POSITIVE', 'ABS', 'ROUND', 'CEILING', 'FLOOR', 'MIN', 'MAX', 'SUM', 'AVERAGE', 'AVG', 'COUNT'].includes(op)) return fail('#NAME?');
  const get = (index: number) => args[index] ? evaluatePropertyFormula(args[index], read,readColumn,aggregateMemo) : fail('#VALUE!');
  if (op === 'IF') { if (args.length < 2 || args.length > 3) fail('#VALUE!'); return get(0) ? get(1) : args[2] ? get(2) : false; }
  if (op === 'IFS') { if (args.length % 2) fail('#VALUE!'); for (let i = 0; i < args.length; i += 2) if (get(i)) return get(i + 1); return fail('#N/A!'); }
  const aggregate=['SUM','AVERAGE','AVG','COUNT','MIN','MAX'].includes(op);
  const values = args.flatMap(arg => 'column' in arg ? aggregate && readColumn?readColumn(arg.column):fail('#VALUE!') : [evaluatePropertyFormula(arg, read,readColumn,aggregateMemo)]);
  const nums = () => values.map(number);
  if (op === '&' || op === 'CONCATENATE' || op === 'CONCAT') return values.join('');
  if (['UPPER', 'LOWER', 'TRIM', 'LEN'].includes(op)) { if (values.length !== 1) fail('#VALUE!'); const text = String(values[0]); return op === 'UPPER' ? text.toUpperCase() : op === 'LOWER' ? text.toLowerCase() : op === 'LEN' ? text.length : text.trim().replace(/\s+/g, ' '); }
  if (op === 'NOT') return !values[0];
  if (op === 'AND') return values.every(Boolean);
  if (op === 'OR') return values.some(Boolean);
  if (['=', '<>', '!=', '<', '>', '<=', '>='].includes(op)) { const [a, b] = values; const equal = String(a).toLowerCase() === String(b).toLowerCase(); return op === '=' ? equal : op === '<>' || op === '!=' ? !equal : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b; }
  const [a, b] = nums();
  if (op === '+') return a + b; if (op === '-') return a - b; if (op === '*') return a * b;
  if (op === '/') return b === 0 ? fail('#DIV/0!') : a / b;
  if (op === '^') return a ** b; if (op === 'NEGATE') return -a; if (op === 'POSITIVE') return a;
  if (op === 'ABS') return Math.abs(a);
  if (op === 'ROUND') { const factor = 10 ** (b ?? 0); return Math.round(a * factor) / factor; }
  if (op === 'CEILING' || op === 'FLOOR') { const step = b ?? 1; return !step ? fail('#DIV/0!') : (op === 'CEILING' ? Math.ceil(a / step) : Math.floor(a / step)) * step; }
  if (op === 'MIN') return Math.min(...nums()); if (op === 'MAX') return Math.max(...nums());
  if (op === 'SUM') return nums().reduce((total, next) => total + next, 0);
  if (op === 'AVERAGE' || op === 'AVG') return values.length ? nums().reduce((total, next) => total + next, 0) / values.length : fail('#DIV/0!');
  if (op === 'COUNT') return values.filter(value => Number.isFinite(Number(value))).length;
  return fail('#NAME?');
}

export function propertyDefinitions(template: CodexTemplate): CodexPropertyDefinition[] {
  const definitions = [...template.propertyDefinitions ?? []];
  for (const key of Object.keys(template.fields)) if (!definitions.some(item => item.key === key)) definitions.push({ id: `legacy:${key}`, key, label: key, kind: 'text' });
  return definitions;
}
export function displayPropertyFormula(definition: CodexPropertyDefinition, definitions: readonly CodexPropertyDefinition[]): string {
  return (definition.formula ?? '').replace(/@\[([^\]]+)\]/g, (token, name: string) => { const id = definition.formulaBindings?.[name]; return id ? `@[${definitions.find(item => item.id === id)?.label ?? name}]` : token; });
}
export function bindPropertyFormulas(template: CodexTemplate, available?: readonly CodexPropertyDefinition[]): CodexTemplate {
  const definitions = propertyDefinitions(template);
  const universe = available ?? definitions;
  const ids = new Set<string>(), keys = new Set<string>(), labels = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id || !definition.key.trim() || !definition.label.trim() || definition.label.includes(']') || ids.has(definition.id) || keys.has(foldAlias(definition.key)) || labels.has(foldAlias(definition.label)) || !['text', 'number', 'date', 'color', 'multiselect'].includes(definition.kind)) throw new Error('property_definition_invalid');
    ids.add(definition.id); keys.add(foldAlias(definition.key)); labels.add(foldAlias(definition.label));
    if (definition.presets !== undefined && (!Array.isArray(definition.presets) || definition.presets.some(value => typeof value !== 'string'))) throw new Error('property_presets_invalid');
    if(definition.optionColors!==undefined){
      const colors=definition.optionColors;
      if(!colors||typeof colors!=='object'||Array.isArray(colors)||![Object.prototype,null].includes(Object.getPrototypeOf(colors)))throw new Error('property_option_colors_invalid');
      for(const key of Reflect.ownKeys(colors)){const field=Object.getOwnPropertyDescriptor(colors,key);if(typeof key!=='string'||!key.trim()||!field||!('value'in field)||!field.enumerable||typeof field.value!=='string'||!/^#[\da-f]{6}$/i.test(field.value))throw new Error('property_option_colors_invalid');}
    }
    if(definition.resultType!==undefined&&!['whole','decimal','percent','text'].includes(definition.resultType))throw new Error('property_result_type_invalid');
    if (definition.formula !== undefined && typeof definition.formula !== 'string' || definition.formulaBindings !== undefined && (!definition.formulaBindings || typeof definition.formulaBindings !== 'object' || Object.values(definition.formulaBindings).some(value => typeof value !== 'string'))) throw new Error('property_formula_invalid');
  }
  return { ...template, propertyDefinitions: definitions.map(definition => {
    if (!definition.formula?.trim()) return { ...definition, formula: undefined, formulaBindings: undefined };
    const bindings: Record<string, string> = {};
    for (const match of definition.formula.matchAll(/@\[([^\]]+)\]/g)) { const name = match[1]; bindings[name] = definition.formulaBindings?.[name] ?? universe.find(item => foldAlias(item.label) === foldAlias(name) || foldAlias(item.key) === foldAlias(name))?.id ?? `missing:${name}`; }
    return { ...definition, formulaBindings: bindings };
  }) };
}

export function validatePropertyValue(definition: CodexPropertyDefinition, value: string): string | undefined {
  if (!value.trim()) return;
  if (definition.kind === 'number' && !Number.isFinite(Number(value))) return '#VALUE!';
  if (definition.kind === 'color' && !/^#[\da-f]{6}$/i.test(value)) return '#VALUE!';
  if (definition.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return '#VALUE!';
  if (definition.kind === 'multiselect') { try { const values: unknown = JSON.parse(value); if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) return '#VALUE!'; } catch { return '#VALUE!'; } }
}

/** Current inputs and inherited definitions project everywhere without saving a cache. */
export function projectCodexEntry(entry: CodexEntry, templates: readonly CodexTemplate[] = []): { fields: Record<string, string>; properties: Record<string, ProjectedProperty> } {
  const raw = templates.find(item => item.id === entry.templateId);
  const effective = raw ? effectiveCodexTemplate(raw, templates) : entry.propertyDefinitions?.length ? { id: entry.templateId ?? '', name: '', category: entry.type, fields: {}, content: '', revision: 0, createdAt: 0, updatedAt: 0, propertyDefinitions: entry.propertyDefinitions } satisfies CodexTemplate : undefined;
  let definitions = effective ? propertyDefinitions(effective) : [];
  // Imported older definitions may not have compiled bindings yet.
  if (effective && definitions.some(item => item.formula && !item.formulaBindings)) {
    try { definitions = bindPropertyFormulas(effective).propertyDefinitions ?? []; } catch { /* Each malformed definition still reports its own error below. */ }
  }
  const byId = new Map(definitions.map(item => [item.id, item])), visiting = new Set<string>(), cache = new Map<string, Value>();
  const circular = new Set<string>(), checked = new Set<string>(), path: string[] = [];
  const check = (id: string) => {
    const position = path.indexOf(id); if (position >= 0) { for (const member of path.slice(position)) circular.add(member); return; }
    if (checked.has(id)) return;
    path.push(id);
    for (const target of Object.values(byId.get(id)?.formulaBindings ?? {})) if (byId.get(target)?.formula) check(target);
    path.pop(); checked.add(id);
  };
  for (const definition of definitions) if (definition.formula) check(definition.id);
  const fields = { ...entry.fields }, properties: Record<string, ProjectedProperty> = {};
  const read = (id: string): Value => {
    if (cache.has(id)) return cache.get(id)!;
    const definition = byId.get(id); if (!definition) return fail('#REF!');
    if (circular.has(id)) return fail('#CIRCULAR!');
    if (visiting.has(id)) return fail('#CIRCULAR!');
    visiting.add(id);
    try {
      const rawValue = entry.fields[definition.key] ?? '';
      const value = definition.formula ? evaluatePropertyFormula(parsePropertyFormula(definition.formula, definition.formulaBindings ?? {}), read) : rawValue.trim() ? validatePropertyValue(definition, rawValue) ? fail('#VALUE!') : definition.kind === 'number' ? Number(rawValue) : rawValue : fail('');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('#NUM!');
      if(definition.formula&&definition.resultType&&(definition.resultType==='text'?typeof value!=='string':typeof value!=='number'))fail('#VALUE!');
      if (definition.formula && (definition.kind === 'number' && typeof value !== 'number' || validatePropertyValue(definition, String(value)))) fail('#VALUE!');
      cache.set(id, value); return value;
    } finally { visiting.delete(id); }
  };
  for (const definition of definitions) {
    let value = '', error: string | undefined, options:ProjectedPropertyOption[]|undefined;
    try { const result = read(definition.id); value = String(result); if (definition.kind === 'multiselect') { options=(JSON.parse(value) as string[]).map(option=>codexOptionAppearance(definition,option));value=options.map(option=>option.value).join(', '); } } catch (reason) { error = reason instanceof Error ? reason.message : '#CALC!'; value = error; }
    fields[definition.key] = value;
    properties[definition.key] = { label: definition.label, value, ...(definition.resultType?{displayValue:formatCalculationValue(value,definition.resultType)}:{}), status: error ? 'error' : value ? 'value' : 'empty', ...(error ? { error } : {}), calculated: Boolean(definition.formula),...(options?{options}:{}) };
  }
  for (const [key, value] of Object.entries(fields)) properties[key] ??= { label: key, value, status: value ? 'value' : 'empty', calculated: false };
  return { fields, properties };
}

/** Formatting is presentation only: callers continue calculating with the raw value. */
export function formatCalculationValue(value:string,type?:CalculationResultType):string {
 if(!type||type==='text'||!value||value.startsWith('#'))return value;
 const number=Number(value);if(!Number.isFinite(number))return '#VALUE!';
 return type==='whole'?String(Math.round(number)):type==='percent'?(Number.isFinite(number*100)?`${Number((number*100).toFixed(2))}%`:'#NUM!'):String(number);
}
/** Stable identities are inspectable without evaluating a formula. */
export function propertyFormulaDependencies(node:FormulaNode):{rows:Set<string>;columns:Set<string>}{const rows=new Set<string>(),columns=new Set<string>();const visit=(next:FormulaNode)=>{if('ref'in next)rows.add(next.ref);else if('column'in next)columns.add(next.column);else if('op'in next)next.args.forEach(visit);};visit(node);return{rows,columns};}
