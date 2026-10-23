// Player handouts drawn as vector paper: a letter, a case file, a terminal
// screen and a notice board. The text stays editable (a definition with a
// title, a body, a signature and one extra line), the picture is redrawn from
// it. Layout is measured with a canvas the way the character-sheet paper is,
// and the picture is rasterised the way the cover designer's export is.
import type { HandoutSource } from '@/types';
import { COVER_FONT_STACKS } from '@/engines/writings/coverDesign/model';
import type { PrepLang } from './model';

export const HANDOUT_TEMPLATES = ['letter', 'casefile', 'terminal', 'noticeboard'] as const;
export type HandoutTemplate = typeof HANDOUT_TEMPLATES[number];
export type HandoutDefinition = HandoutSource;
export const HANDOUT_LIMITS = { title: 120, body: 4000, signature: 80, extra: 120 } as const;
export const isHandoutTemplate = (value: unknown): value is HandoutTemplate => (HANDOUT_TEMPLATES as readonly unknown[]).includes(value);

export const HANDOUT_TEMPLATE_NAMES: Record<HandoutTemplate, { es: string; en: string; titleHint: { es: string; en: string }; extraHint: { es: string; en: string }; signatureHint: { es: string; en: string } }> = {
  letter: { es: 'Carta', en: 'Letter', titleHint: { es: 'Encabezado (opcional)', en: 'Heading (optional)' }, extraHint: { es: 'Lugar y fecha', en: 'Place and date' }, signatureHint: { es: 'Firma', en: 'Signature' } },
  casefile: { es: 'Expediente', en: 'Case file', titleHint: { es: 'Nombre del caso', en: 'Case name' }, extraHint: { es: 'Número de expediente', en: 'File number' }, signatureHint: { es: 'Archivista o instructor', en: 'Clerk or investigator' } },
  terminal: { es: 'Pantalla de terminal', en: 'Terminal screen', titleHint: { es: 'Nombre del sistema', en: 'System name' }, extraHint: { es: 'Línea de acceso', en: 'Login line' }, signatureHint: { es: 'Pie (opcional)', en: 'Footer (optional)' } },
  noticeboard: { es: 'Tablón de anuncios', en: 'Notice board', titleHint: { es: 'Rótulo del tablón', en: 'Board sign' }, extraHint: { es: 'Subtítulo', en: 'Subtitle' }, signatureHint: { es: 'Sin uso', en: 'Unused' } },
};

const text = (value: unknown, max: number, keepBreaks = false): string => {
  if (typeof value !== 'string') return '';
  const cleaned = Array.from(value.replace(/\r\n?/g, '\n'), char => (char === '\n' && keepBreaks ? char : char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  return (keepBreaks ? cleaned.split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n') : cleaned.replace(/\s+/g, ' ')).trim().slice(0, max);
};
export function normalizeHandoutDefinition(raw: unknown): HandoutDefinition {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { template: isHandoutTemplate(value.template) ? value.template : 'letter', title: text(value.title, HANDOUT_LIMITS.title), body: text(value.body, HANDOUT_LIMITS.body, true), signature: text(value.signature, HANDOUT_LIMITS.signature), extra: text(value.extra, HANDOUT_LIMITS.extra), lang: value.lang === 'en' ? 'en' : 'es' };
}
/** The readable text of a handout, for notes and gallery captions. */
export function handoutPlainText(definition: HandoutDefinition): string {
  return [definition.title, definition.extra, definition.body, definition.signature].filter(Boolean).join('\n');
}

/** Opening hooks for a session, as text to start a letter or a read-aloud box from. */
export const HOOK_PRESETS = ['visitor', 'discovery', 'sudden'] as const;
export type HookPreset = typeof HOOK_PRESETS[number];
export const HOOK_PRESET_NAMES: Record<HookPreset, { es: string; en: string }> = {
  visitor: { es: 'Una visita inesperada', en: 'An unexpected visitor' },
  discovery: { es: 'Un hallazgo', en: 'A discovery' },
  sudden: { es: 'Un suceso repentino', en: 'A sudden event' },
};
const HOOKS: Record<HookPreset, Record<PrepLang, Omit<HandoutDefinition, 'template' | 'lang'>>> = {
  visitor: {
    es: { title: 'A quien corresponda', extra: 'Escrito a la luz de una vela, sin fecha', body: 'Sé que no me conocéis y que esta carta os llegará por mano de un desconocido. Necesito veros antes de que anochezca el tercer día.\n\nNo diré aquí el motivo; basta con que sepáis que otros han muerto por saberlo. Llevad lo imprescindible y no habléis de esto en la posada.\n\nOs espero donde el camino se parte en dos.', signature: 'Un amigo que prefiere no dar su nombre' },
    en: { title: 'To whom it may concern', extra: 'Written by candlelight, undated', body: 'I know you do not know me, and that this letter will reach you through a stranger. I need to see you before the third night falls.\n\nI will not write the reason here; it is enough that others have died for knowing it. Bring only what you must, and say nothing of this at the inn.\n\nI will wait where the road splits in two.', signature: 'A friend who would rather not give a name' },
  },
  discovery: {
    es: { title: 'Hoja suelta, hallada entre los restos', extra: 'La tinta se ha corrido en una esquina', body: 'Lo que buscáis no está en el sótano, como dijo el prior. Está debajo del sótano.\n\nLa escalera se esconde tras el tercer estante; la piedra clara abre, la oscura cierra. No toquéis la que tiene la marca de la mano.\n\nSi leéis esto, ya es tarde para mí.', signature: 'H.' },
    en: { title: 'A loose page, found among the wreckage', extra: 'The ink has run in one corner', body: 'What you are looking for is not in the cellar, as the prior said. It is beneath the cellar.\n\nThe stairs hide behind the third shelf; the pale stone opens, the dark one shuts. Do not touch the one with the mark of the hand.\n\nIf you are reading this, it is already too late for me.', signature: 'H.' },
  },
  sudden: {
    es: { title: 'Aviso urgente', extra: 'Pegado en la puerta esta mañana', body: 'Por orden de la guardia, nadie saldrá del pueblo hasta nuevo aviso.\n\nLas campanas tocarán tres veces si el río sube. Quien oiga cuatro, que corra a la colina sin mirar atrás.\n\nLa ración de pan se repartirá a mediodía en la plaza.', signature: 'La guardia del pueblo' },
    en: { title: 'Urgent notice', extra: 'Nailed to the door this morning', body: 'By order of the watch, nobody leaves the village until further notice.\n\nThe bells will ring three times if the river rises. Whoever hears four should run for the hill without looking back.\n\nBread will be shared out at noon in the square.', signature: 'The village watch' },
  },
};
export function hookPreset(preset: HookPreset, lang: PrepLang): Omit<HandoutDefinition, 'template'> {
  return { ...HOOKS[preset][lang], lang };
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const SERIF = COVER_FONT_STACKS.palatino, MONO = COVER_FONT_STACKS.courier, SANS = COVER_FONT_STACKS.trebuchet;

function measurer(font: string) {
  const context = document.createElement('canvas').getContext('2d');
  if (context) context.font = font;
  return (value: string) => context ? context.measureText(value).width : value.length * 9;
}
/** Words kept on a line while they fit; a word longer than the line breaks by letter. */
function wrap(value: string, width: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (measure(line + word) <= width) { line += word; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      for (const char of Array.from(word.trimStart())) { if (measure(line + char) > width && line) { lines.push(line); line = ''; } line += char; }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
const tspans = (x: number, lines: string[], step: number) => lines.map((line, index) => `<tspan x="${x}" dy="${index ? step : 0}">${esc(line) || '&#160;'}</tspan>`).join('');
const svgOpen = (width: number, height: number, label: string, template: HandoutTemplate, defs: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" data-handout-template="${template}"><defs>${defs}</defs>`;

interface Drawn { svg: string; width: number; height: number }

function drawLetter(d: HandoutDefinition): Drawn {
  const W = 760, M = 74, bodyFont = `italic 21px ${SERIF}`, measure = measurer(bodyFont), body = wrap(d.body, W - M * 2, measure);
  let y = 92; const parts: string[] = [];
  if (d.title) { parts.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${esc(SERIF)}" font-size="30" font-weight="700" fill="#3b2a14">${esc(d.title)}</text>`); y += 40; }
  if (d.extra) { parts.push(`<text x="${W - M}" y="${y}" text-anchor="end" font-family="${esc(SERIF)}" font-size="17" font-style="italic" fill="#5a4630">${esc(d.extra)}</text>`); y += 40; }
  parts.push(`<text xml:space="preserve" x="${M}" y="${y}" font-family="${esc(SERIF)}" font-size="21" font-style="italic" fill="#2f2415">${tspans(M, body, 33)}</text>`);
  y += Math.max(0, body.length - 1) * 33 + 66;
  const initial = Array.from(d.signature || d.title || '?')[0]?.toUpperCase() ?? '?';
  if (d.signature) parts.push(`<text x="${W - M - 10}" y="${y}" text-anchor="end" font-family="'Brush Script MT','Segoe Script',cursive" font-size="34" fill="#1f2a4a">${esc(d.signature)}</text><path d="M${W - M - 250} ${y + 14} q 80 -12 160 0 t 160 -2" fill="none" stroke="#1f2a4a" stroke-width="1.6" opacity=".55"/>`);
  parts.push(`<g transform="translate(${M + 36} ${y - 6})"><circle r="32" fill="url(#wax)"/><circle r="23" fill="none" stroke="#5a1209" stroke-width="2" opacity=".6"/><text y="9" text-anchor="middle" font-family="${esc(SERIF)}" font-size="26" font-weight="700" fill="#5a1209" opacity=".8">${esc(initial)}</text></g>`);
  const H = Math.ceil(y + 84);
  const defs = `<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7edd3"/><stop offset=".55" stop-color="#eedcb4"/><stop offset="1" stop-color="#e2c993"/></linearGradient><radialGradient id="wax"><stop offset="0" stop-color="#b3281a"/><stop offset="1" stop-color="#6e1108"/></radialGradient><radialGradient id="stain"><stop offset="0" stop-color="#8a6a2f" stop-opacity=".28"/><stop offset="1" stop-color="#8a6a2f" stop-opacity="0"/></radialGradient>`;
  const frame = `<rect width="${W}" height="${H}" fill="#3d2f1f"/><rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="6" fill="url(#paper)" stroke="#b99b62" stroke-width="2"/><rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="#a98a4f" stroke-width="1" opacity=".6"/><circle cx="${W - 130}" cy="${H - 150}" r="90" fill="url(#stain)"/><circle cx="130" cy="150" r="70" fill="url(#stain)"/><path d="M14 ${Math.round(H / 3)} H${W - 14} M14 ${Math.round(H * 2 / 3)} H${W - 14}" stroke="#8a6a2f" stroke-opacity=".14" stroke-width="2"/>`;
  return { svg: `${svgOpen(W, H, d.title || 'Letter', 'letter', defs)}${frame}${parts.join('')}</svg>`, width: W, height: H };
}

function drawCaseFile(d: HandoutDefinition): Drawn {
  const W = 820, sheetX = 70, sheetW = W - 140, pad = 40, font = `18px ${MONO}`, measure = measurer(font);
  const body = wrap(d.body, sheetW - pad * 2, measure);
  const heading = d.title ? wrap(d.title.toUpperCase(), sheetW - pad * 2 - 240, measurer(`bold 24px ${MONO}`)) : [];
  const parts: string[] = [];
  let y = 150;
  if (d.extra) parts.push(`<text x="${sheetX + pad}" y="${y}" font-family="${esc(MONO)}" font-size="16" fill="#6b6354">${esc(d.extra)}</text>`);
  y += 36;
  if (heading.length) { parts.push(`<text x="${sheetX + pad}" y="${y}" font-family="${esc(MONO)}" font-size="24" font-weight="700" fill="#1f1d19">${tspans(sheetX + pad, heading, 30)}</text>`); y += (heading.length - 1) * 30 + 22; }
  parts.push(`<path d="M${sheetX + pad} ${y} H${sheetX + sheetW - pad}" stroke="#1f1d19" stroke-width="2"/>`);
  y += 34;
  parts.push(`<text xml:space="preserve" x="${sheetX + pad}" y="${y}" font-family="${esc(MONO)}" font-size="18" fill="#26231d">${tspans(sheetX + pad, body, 27)}</text>`);
  y += Math.max(0, body.length - 1) * 27 + 52;
  if (d.signature) { parts.push(`<path d="M${sheetX + pad} ${y} H${sheetX + pad + 260}" stroke="#26231d" stroke-width="1"/><text x="${sheetX + pad}" y="${y + 24}" font-family="${esc(MONO)}" font-size="16" fill="#26231d">${esc(d.signature)}</text>`); y += 40; }
  const sheetBottom = y + 24, H = Math.ceil(sheetBottom + 70), stamp = d.lang === 'en' ? 'CONFIDENTIAL' : 'CONFIDENCIAL';
  const defs = `<filter id="roughen"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter><linearGradient id="folder" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcb872"/><stop offset="1" stop-color="#c79c52"/></linearGradient>`;
  const folder = `<rect width="${W}" height="${H}" fill="#5b4a37"/><path d="M30 120 V${H - 30} H${W - 30} V${120} H${W - 330} L${W - 352} 86 H${W - 560} L${W - 582} 120 Z" fill="url(#folder)" stroke="#8a6a30" stroke-width="2"/><rect x="${W - 546}" y="90" width="190" height="30" fill="none"/><text x="${W - 456}" y="112" text-anchor="middle" font-family="${esc(MONO)}" font-size="15" fill="#5a4318">${esc((d.extra || d.title).slice(0, 22))}</text>`;
  const sheet = `<g transform="rotate(-1.1 ${W / 2} ${H / 2})"><rect x="${sheetX + 5}" y="${112 + 5}" width="${sheetW}" height="${sheetBottom - 112}" fill="#000" opacity=".22"/><rect x="${sheetX}" y="112" width="${sheetW}" height="${sheetBottom - 112}" fill="#fbf9f1" stroke="#cfc8b4"/>${parts.join('')}<g transform="translate(${sheetX + sheetW - pad - 210} 176) rotate(-9)" filter="url(#roughen)"><rect x="-6" y="-30" width="${stamp.length * 15 + 24}" height="44" fill="none" stroke="#b3261c" stroke-width="3.5" opacity=".78"/><text x="6" y="2" font-family="${esc(SANS)}" font-size="24" font-weight="800" fill="#b3261c" opacity=".78">${stamp}</text></g><path d="M${sheetX + 54} 100 v 62 a 9 9 0 0 0 18 0 V 90 a 15 15 0 0 0 -30 0 v 56" fill="none" stroke="#9aa0a6" stroke-width="3.2" stroke-linecap="round"/></g>`;
  return { svg: `${svgOpen(W, H, d.title || 'Case file', 'casefile', defs)}${folder}${sheet}</svg>`, width: W, height: H };
}

function drawTerminal(d: HandoutDefinition): Drawn {
  const W = 860, M = 62, font = `20px ${MONO}`, measure = measurer(font), body = wrap(d.body, W - M * 2 - 20, measure);
  const lines = [...(d.extra ? [d.extra, ''] : []), ...body];
  const H = Math.ceil(150 + lines.length * 28 + 96);
  const rows = lines.map((line, index) => `<tspan x="${M}" dy="${index ? 28 : 0}" fill="${line.startsWith('>') ? '#c9ffdc' : '#74f5a0'}">${esc(line) || '&#160;'}</tspan>`).join('');
  const defs = `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.4" fill="#000" opacity=".28"/></pattern><radialGradient id="vignette" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>`;
  const y0 = 150, cursorY = y0 + Math.max(0, lines.length - 1) * 28 + 36;
  const svg = `${svgOpen(W, H, d.title || 'Terminal', 'terminal', defs)}<rect width="${W}" height="${H}" fill="#1b211e"/><rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="#08120c" stroke="#314239" stroke-width="3"/><rect x="18" y="18" width="${W - 36}" height="48" rx="20" fill="#14211a"/><rect x="18" y="46" width="${W - 36}" height="20" fill="#14211a"/><circle cx="52" cy="42" r="7" fill="#d9534f"/><circle cx="76" cy="42" r="7" fill="#e6b422"/><circle cx="100" cy="42" r="7" fill="#46b36a"/><text x="${W / 2}" y="48" text-anchor="middle" font-family="${esc(MONO)}" font-size="16" fill="#7fbf96">${esc(d.title || 'TERMINAL')}</text><text xml:space="preserve" x="${M}" y="${y0}" font-family="${esc(MONO)}" font-size="20" filter="url(#glow)">${rows}</text>${d.signature ? `<text x="${W - M}" y="${H - 60}" text-anchor="end" font-family="${esc(MONO)}" font-size="15" fill="#4f9d6b" filter="url(#glow)">${esc(d.signature)}</text>` : ''}<text x="${M}" y="${cursorY}" font-family="${esc(MONO)}" font-size="20" fill="#74f5a0" filter="url(#glow)">&gt;</text><rect x="${M + 20}" y="${cursorY - 18}" width="12" height="22" fill="#74f5a0" filter="url(#glow)"/><rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="url(#scan)"/><rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="url(#vignette)"/></svg>`;
  return { svg, width: W, height: H };
}

const NOTE_COLOURS = ['#fff2a8', '#ffd6cc', '#d3e8ff', '#dff2c9', '#f0ddff', '#ffe6bd'];
function drawNoticeBoard(d: HandoutDefinition): Drawn {
  const W = 900, M = 48, gap = 36, cardW = (W - M * 2 - gap) / 2, textW = cardW - 44, regular = measurer(`16px ${SANS}`), heading = measurer(`bold 19px ${SANS}`);
  const notices = d.body.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).slice(0, 10);
  const cards = notices.map((notice, index) => {
    const [first, ...rest] = notice.split('\n'), head = wrap(first, textW, heading), lines = rest.length ? wrap(rest.join('\n'), textW, regular) : [];
    return { index, head, lines, height: 52 + head.length * 25 + (lines.length ? 8 + lines.length * 22 : 0) };
  });
  const columns = [150, 150]; const placed = cards.map(card => { const column = columns[0] <= columns[1] ? 0 : 1, x = M + column * (cardW + gap), y = columns[column]; columns[column] += card.height + 30; return { ...card, x, y }; });
  const H = Math.ceil(Math.max(columns[0], columns[1], 320) + 40);
  const defs = `<pattern id="cork" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#b88a58"/><circle cx="3" cy="4" r="1.5" fill="#9a6f43" opacity=".7"/><circle cx="10" cy="10" r="1.2" fill="#d6aa78" opacity=".7"/><circle cx="11" cy="3" r="1" fill="#8a6038" opacity=".6"/></pattern><linearGradient id="plank" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5632"/><stop offset="1" stop-color="#583a1f"/></linearGradient>`;
  const noteSvg = placed.map(card => {
    const colour = NOTE_COLOURS[card.index % NOTE_COLOURS.length], tilt = [-1.8, 1.4, -0.8, 2, -1.2, 0.9][card.index % 6];
    return `<g transform="rotate(${tilt} ${card.x + cardW / 2} ${card.y + card.height / 2})"><rect x="${card.x + 4}" y="${card.y + 5}" width="${cardW}" height="${card.height}" fill="#000" opacity=".25"/><rect x="${card.x}" y="${card.y}" width="${cardW}" height="${card.height}" fill="${colour}"/><circle cx="${card.x + cardW / 2}" cy="${card.y + 12}" r="7" fill="#c0392b"/><circle cx="${card.x + cardW / 2 - 2}" cy="${card.y + 10}" r="2.2" fill="#fff" opacity=".6"/><text x="${card.x + 22}" y="${card.y + 48}" font-family="${esc(SANS)}" font-size="19" font-weight="700" fill="#2b2418">${tspans(card.x + 22, card.head, 25)}</text>${card.lines.length ? `<text xml:space="preserve" x="${card.x + 22}" y="${card.y + 48 + (card.head.length - 1) * 25 + 30}" font-family="${esc(SANS)}" font-size="16" fill="#3a3224">${tspans(card.x + 22, card.lines, 22)}</text>` : ''}</g>`;
  }).join('');
  const sign = `<rect x="${M}" y="26" width="${W - M * 2}" height="${d.extra ? 98 : 80}" rx="6" fill="url(#plank)" stroke="#3a2512" stroke-width="3"/><text x="${W / 2}" y="${d.extra ? 76 : 80}" text-anchor="middle" font-family="${esc(SERIF)}" font-size="38" font-weight="700" fill="#f2e2c0">${esc(d.title || (d.lang === 'en' ? 'Notice board' : 'Tablón de anuncios'))}</text>${d.extra ? `<text x="${W / 2}" y="108" text-anchor="middle" font-family="${esc(SERIF)}" font-size="18" font-style="italic" fill="#dcc79c">${esc(d.extra)}</text>` : ''}`;
  return { svg: `${svgOpen(W, H, d.title || 'Notice board', 'noticeboard', defs)}<rect width="${W}" height="${H}" fill="url(#cork)"/><rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#5b3d1f" stroke-width="12"/>${sign}${noteSvg}</svg>`, width: W, height: H };
}

/** The handout as a vector picture. */
export function renderHandoutSvg(raw: unknown): Drawn {
  const definition = normalizeHandoutDefinition(raw);
  switch (definition.template) {
    case 'casefile': return drawCaseFile(definition);
    case 'terminal': return drawTerminal(definition);
    case 'noticeboard': return drawNoticeBoard(definition);
    default: return drawLetter(definition);
  }
}
const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
/** The handout as a PNG data URL; `scale` multiplies its pixel size (0.1-3). */
export async function renderHandoutPng(raw: unknown, scale = 1): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 3) throw new Error('handout_scale_invalid');
  const { svg, width, height } = renderHandoutSvg(raw);
  const image = new Image(); image.src = svgDataUrl(svg); await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('handout_renderer_unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
export const handoutSvgUrl = (raw: unknown): string => svgDataUrl(renderHandoutSvg(raw).svg);
