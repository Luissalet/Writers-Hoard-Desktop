// Excel workbooks (.xlsx) in and out, on this device. Import reads every
// worksheet (names, order, hidden tabs, tab colours), cell text and numbers,
// and formulas as formulas; it reports what it could not keep (formatting,
// merged cells, charts, functions the sheet does not compute) instead of
// failing silently. Export writes one worksheet per tab with the formulas and
// their computed values, so Excel and other spreadsheet programs open it.
import JSZip from 'jszip';
import { cellKey, type WorldTable } from './types';
import { sheetValues, SHEET_FUNCTIONS } from './formulas';

export const XLSX_LIMITS = { bytes: 20_000_000, sheets: 50, rows: 20000, columns: 100 } as const;
export interface ImportedSheet { name: string; hidden: boolean; color?: string; rows: string[][] }
export interface XlsxReport { sheets: number; cells: number; formulas: number; unsupportedFunctions: string[]; truncated: string[]; dropped: string[] }

/** A character reference, bounded to real characters: out-of-range or surrogate values become U+FFFD instead of aborting the import. */
const codePoint = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0x10FFFF && !(value >= 0xD800 && value <= 0xDFFF) && value !== 0 ? String.fromCodePoint(value) : '\uFFFD';
const decode = (text: string) => text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, code: string) => code === 'lt' ? '<' : code === 'gt' ? '>' : code === 'amp' ? '&' : code === 'quot' ? '"' : code === 'apos' ? "'" : codePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))));
const encode = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!).split('').filter(char => { const code = char.charCodeAt(0); return code >= 32 || code === 9 || code === 10 || code === 13; }).join('');
const attribute = (tag: string, name: string) => { const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return match ? decode(match[1]) : undefined; };
/** Text of <t> runs inside a string item (plain or rich text), ignoring phonetic runs. */
const runs = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(match => decode(match[1] ?? '')).join('');
const columnNumber = (letters: string) => { let value = 0; for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64; return value - 1; };
const KNOWN = new Set<string>([...SHEET_FUNCTIONS, 'TRUE', 'FALSE']);

/** Move relative references (not $-anchored parts) by rows and columns, leaving quoted text alone. */
export function moveReferences(formula: string, rows: number, columns: number): string {
  const letters = (index: number) => cellKey(index, 0).replace(/\d+$/, '');
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(/(\$?)\b([A-Z]{1,3})(\$?)([1-9]\d*)\b(?!\s*\()/g, (_, fixedColumn: string, column: string, fixedRow: string, row: string) =>
    `${fixedColumn}${fixedColumn ? column : letters(Math.max(0, columnNumber(column) + columns))}${fixedRow}${fixedRow ? row : Math.max(1, Number(row) + rows)}`)).join('');
}

export class XlsxError extends Error {
  readonly code: 'encrypted' | 'not_xlsx' | 'too_large' | 'empty';
  constructor(code: XlsxError['code']) { super(`xlsx_${code}`); this.name = 'XlsxError'; this.code = code; }
}

export async function importXlsx(bytes: Uint8Array): Promise<{ sheets: ImportedSheet[]; report: XlsxReport }> {
  if (bytes.byteLength > XLSX_LIMITS.bytes) throw new XlsxError('too_large');
  // A password-protected workbook is an OLE compound file, not a zip.
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) throw new XlsxError('encrypted');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new XlsxError('not_xlsx');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new XlsxError('not_xlsx'); }
  const read = async (path: string) => { const file = zip.file(path); return file ? file.async('string') : undefined; };
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new XlsxError('not_xlsx');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(match => [attribute(match[0], 'Id') ?? '', attribute(match[0], 'Target') ?? '']));
  // An empty entry (<si/>) or one with attributes still takes its place in the index.
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(match => match[1] === undefined ? '' : runs(match[1]));
  const report: XlsxReport = { sheets: 0, cells: 0, formulas: 0, unsupportedFunctions: [], truncated: [], dropped: [] };
  const unsupported = new Set<string>();
  const sheets: ImportedSheet[] = [];
  const entries = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map(match => match[0]);
  if (entries.length > XLSX_LIMITS.sheets) report.truncated.push(`sheets>${XLSX_LIMITS.sheets}`);
  for (const tag of entries.slice(0, XLSX_LIMITS.sheets)) {
    const name = attribute(tag, 'name') ?? `Sheet${sheets.length + 1}`, state = attribute(tag, 'state'), id = attribute(tag, 'r:id') ?? '';
    const target = targets.get(id) ?? '', path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (!xml) { report.dropped.push(`${name}: not a worksheet (chart or macro sheet)`); continue; }
    const color = /<tabColor\b[^>]*rgb="(?:FF)?([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
    const grid: string[][] = [];
    const masters = new Map<string, { formula: string; row: number; column: number }>();
    let cut = false;
    for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1], body = cell[2] ?? '', ref = /\sr="([A-Z]+)(\d+)"/.exec(attrs);
      if (!ref) continue;
      const column = columnNumber(ref[1]), row = Number(ref[2]) - 1;
      if (column >= XLSX_LIMITS.columns || row >= XLSX_LIMITS.rows) { cut = true; continue; }
      const type = /\st="([^"]+)"/.exec(attrs)?.[1], raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const fTag = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body), sharedFormula = fTag ? /\st="shared"/.test(fTag[1]) : false, si = fTag ? /\ssi="(\d+)"/.exec(fTag[1])?.[1] : undefined;
      let formula = fTag?.[2] !== undefined ? decode(fTag[2]) : undefined;
      // A shared formula is written once; the other cells take it moved by their distance from it.
      if (sharedFormula && si !== undefined) {
        if (formula?.trim()) masters.set(si, { formula, row, column });
        else { const master = masters.get(si); if (master) formula = moveReferences(master.formula, row - master.row, column - master.column); }
      }
      let value = '';
      if (formula !== undefined && formula.trim()) {
        value = `=${formula}`; report.formulas++;
        if (/!/.test(value.replace(/"(?:[^"]|"")*"/g, ''))) unsupported.add('Hoja!A1 / Sheet!A1');
        for (const fn of value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/([A-Z][A-Z0-9.]*)\s*\(/gi)) if (!KNOWN.has(fn[1].toUpperCase().replace(/^_XLFN\./, ''))) unsupported.add(fn[1].toUpperCase());
        value = value.replace(/_xlfn\./gi, '');
      } else if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = runs(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw !== undefined) value = decode(raw);
      if (value === '') continue;
      while (grid.length <= row) grid.push([]);
      grid[row][column] = value; report.cells++;
    }
    if (cut) report.truncated.push(`${name}: past ${XLSX_LIMITS.rows} rows or ${XLSX_LIMITS.columns} columns`);
    if (/<mergeCell\b/.test(xml)) report.dropped.push(`${name}: merged cells (kept as separate cells)`);
    if (/<conditionalFormatting\b/.test(xml) || /\ss="\d+"/.test(xml)) report.dropped.push(`${name}: formatting`);
    const width = Math.max(1, ...grid.map(line => line.length));
    sheets.push({ name: name.slice(0, 200), hidden: state === 'hidden' || state === 'veryHidden', ...(color ? { color: `#${color.toLowerCase()}` } : {}), rows: grid.map(line => Array.from({ length: width }, (_, i) => line[i] ?? '')) });
    report.sheets++;
  }
  if (zip.file(/^xl\/charts\//).length) report.dropped.push('charts');
  if (zip.file(/^xl\/drawings\//).length) report.dropped.push('drawings and images');
  if (zip.file('xl/vbaProject.bin')) report.dropped.push('macros (never run)');
  if (!sheets.length) throw new XlsxError('empty');
  report.unsupportedFunctions = [...unsupported].sort();
  return { sheets, report };
}

/** Writer sheets from an imported workbook: one per worksheet, grouped as one workbook. */
export function sheetsToTables(imported: ImportedSheet[], workbookName: string): WorldTable[] {
  const workbookId = crypto.randomUUID();
  return imported.map((sheet, order) => {
    const width = Math.max(1, sheet.rows[0]?.length ?? 1);
    const columns = Array.from({ length: width }, (_, index) => ({ id: crypto.randomUUID(), name: cellKey(index, 0).replace(/\d+$/, ''), kind: 'text' as const }));
    return { id: crypto.randomUUID(), title: sheet.name, mode: 'sheet', columns, rows: (sheet.rows.length ? sheet.rows : [[]]).map(line => ({ id: crypto.randomUUID(), cells: Object.fromEntries(columns.flatMap((column, index) => line[index] ? [[column.id, line[index]]] : [])) })), workbook: { id: workbookId, name: workbookName.slice(0, 200), order, ...(sheet.color ? { color: sheet.color } : {}), ...(sheet.hidden ? { hidden: true } : {}) } } satisfies WorldTable;
  });
}

const ALIAS_TO_EXCEL: Record<string, string> = { SUMA: 'SUM', PROMEDIO: 'AVERAGE', AVG: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', SI: 'IF', Y: 'AND', O: 'OR', NO: 'NOT', 'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF', 'PROMEDIO.SI': 'AVERAGEIF', BUSCARV: 'VLOOKUP', CONCATENAR: 'CONCATENATE', LARGO: 'LEN', MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM', REDONDEAR: 'ROUND', 'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN', MEDIANA: 'MEDIAN', RESIDUO: 'MOD', POTENCIA: 'POWER', RAIZ: 'SQRT', ENTERO: 'INT', 'SI.ERROR': 'IFERROR', 'MULTIPLO.INFERIOR': 'FLOOR', 'MULTIPLO.SUPERIOR': 'CEILING', VERDADERO: 'TRUE', FALSO: 'FALSE', CONCAT: '_xlfn.CONCAT', SUMAPRODUCTO: 'SUMPRODUCT' };
/** A formula as Excel stores it: English names, commas between arguments, text untouched. */
export function excelFormula(formula: string, unknown?: Set<string>): string {
  return formula.replace(/^=/, '').split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(/;/g, ',').replace(/([A-Za-z][A-Za-z0-9.]*)(\s*\()/g, (_, name: string, open: string) => {
    const mapped = ALIAS_TO_EXCEL[name.toUpperCase()] ?? name.toUpperCase();
    // A name this sheet does not compute passes through as written; Excel may not know it either (it shows #NAME?).
    if (unknown && !KNOWN.has(mapped.replace(/^_XLFN\./, ''))) unknown.add(mapped);
    return `${mapped}${open}`;
  }).replace(/\b(VERDADERO|FALSO)\b/gi, word => word.toUpperCase() === 'VERDADERO' ? 'TRUE' : 'FALSE')).join('');
}

/** Excel's own error values; anything else starting with "#" is text, not an error. */
const EXCEL_ERRORS = new Set(['#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#REF!', '#VALUE!']);
const excelError = (text: string) => EXCEL_ERRORS.has(text) ? text : /^#(?:FORMULA|CYCLE|DEPTH|LIMIT|ERROR)!$/.test(text) ? '#VALUE!' : undefined;
/** A cell text that is a plain decimal Excel stores exactly as written (no "+", no extra zeros, at most 15 digits). */
export function plainNumber(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || String(value) !== text || text.replace(/^-/, '').replace('.', '').replace(/^0+/, '').length > 15) return undefined;
  return value;
}

function worksheetXml(table: WorldTable, header: boolean, unknown: Set<string>): string {
  const values = table.mode === 'sheet' ? sheetValues(table) : null;
  const lines: string[] = [];
  const cellXml = (ref: string, raw: string, computed: string | number | undefined) => {
    if (raw.startsWith('=') && values) {
      const formula = `<f>${encode(excelFormula(raw, unknown))}</f>`;
      if (computed === undefined) return `<c r="${ref}">${formula}</c>`;
      if (typeof computed === 'number') return `<c r="${ref}">${formula}<v>${computed}</v></c>`;
      if (computed === 'TRUE' || computed === 'FALSE') return `<c r="${ref}" t="b">${formula}<v>${computed === 'TRUE' ? 1 : 0}</v></c>`;
      const failure = excelError(computed);
      if (failure) return `<c r="${ref}" t="e">${formula}<v>${failure}</v></c>`;
      return `<c r="${ref}" t="str">${formula}<v>${encode(computed)}</v></c>`;
    }
    const number = plainNumber(raw);
    if (number !== undefined) return `<c r="${ref}"><v>${number}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${encode(raw)}</t></is></c>`;
  };
  if (header) lines.push(`<row r="1">${table.columns.map((column, index) => cellXml(cellKey(index, 0), column.name, undefined)).join('')}</row>`);
  table.rows.forEach((row, rowIndex) => {
    const at = rowIndex + (header ? 1 : 0);
    const cells = table.columns.map((column, columnIndex) => { const raw = row.cells[column.id] ?? ''; return raw === '' ? '' : cellXml(cellKey(columnIndex, at), raw, values?.get(cellKey(columnIndex, rowIndex))); }).join('');
    if (cells) lines.push(`<row r="${at + 1}">${cells}</row>`);
  });
  const tab = table.workbook?.color ? `<sheetPr><tabColor rgb="FF${table.workbook.color.replace('#', '').toUpperCase()}"/></sheetPr>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${tab}<sheetData>${lines.join('')}</sheetData></worksheet>`;
}

/** A workbook of these tables, in order. A sheet keeps its formulas (with values); a typed table gets its column names as the first row. */
export async function exportXlsx(tables: WorldTable[]): Promise<Blob> { return (await exportXlsxReport(tables)).blob; }

/** The same workbook, with the function names Excel may not know (they would show #NAME?). */
export async function exportXlsxReport(tables: WorldTable[]): Promise<{ blob: Blob; warnings: string[] }> {
  if (!tables.length) throw new XlsxError('empty');
  const zip = new JSZip(), used = new Set<string>();
  const names = tables.map((table, index) => {
    let name = (table.title || `Hoja${index + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Hoja${index + 1}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 27)} (${n})`;
    used.add(name.toLowerCase()); return name;
  });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables.map((table, i) => `<sheet name="${encode(names[i])}" sheetId="${i + 1}"${table.workbook?.hidden && tables.some(other => !other.workbook?.hidden) ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  const unknown = new Set<string>();
  tables.forEach((table, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(table, table.mode !== 'sheet', unknown)));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  return { blob, warnings: [...unknown].sort() };
}
