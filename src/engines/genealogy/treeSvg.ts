// ============================================================================
// Genealogy tree SVG view (W3) — pure string renderer, no DOM, no I/O, no
// mutation.
//
// renderTreeSvg(characters, links, opts) produces a standalone SVG string
// from the validated genealogy model:
//
//   - one <g data-id="..."> per character, holding a <rect> and a <text>
//     with the escaped name;
//   - one <line> per link: parent kinds get an arrow (marker-end) pointing
//     from parent to child, partner gets a dashed line without arrow;
//   - edge class carries the kind (edge biological_parent, edge adoptive_parent,
//     edge guardian, edge partner) so the view can style them;
//   - a link label (if any) is rendered as a small <text> at the edge midpoint;
//   - coordinates come from layoutGenealogyTree (row/col mapped to pixels via
//     cellW/cellH), so the SVG matches the pure layout exactly.
// ============================================================================

import type { GenealogyLink } from './validate.ts';
import { buildGenealogyTree } from './tree.ts';
import { layoutGenealogyTree } from './layout.ts';

/** Escape the five XML-significant characters for text content and attributes. */
function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export interface TreeSvgOptions {
  /** Horizontal cell size in SVG units (default 120). */
  cellW?: number;
  /** Vertical cell size in SVG units (default 60). */
  cellH?: number;
}

const NODE_W = 100;
const NODE_H = 34;

export function renderTreeSvg(
  characters: ReadonlyArray<{ id: string; name: string }>,
  links: readonly GenealogyLink[],
  opts: TreeSvgOptions = {},
): string {
  const cellW = opts.cellW ?? 120;
  const cellH = opts.cellH ?? 60;

  const layout = layoutGenealogyTree(
    buildGenealogyTree(
      characters.map((c) => ({ id: c.id, name: c.name })),
      [...links],
    ),
  );

  const pos = (id: string): { x: number; y: number } => {
    const p = layout.positions.get(id);
    const col = p?.col ?? 0;
    const row = p?.row ?? 0;
    return { x: col * cellW, y: row * cellH };
  };

  const parts: string[] = [];
  const width = Math.max(1, layout.colCount) * cellW;
  const height = Math.max(1, layout.rowCount) * cellH;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`,
  );

  // Edges first so nodes paint over them.
  for (const link of links) {
    const a = pos(link.from);
    const b = pos(link.to);
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y + NODE_H / 2;
    const isPartner = link.kind === 'partner';
    const arrow = isPartner ? '' : ' marker-end="url(#arrow)"';
    const dash = isPartner ? ' stroke-dasharray="4 3"' : '';
    parts.push(
      `<line class="edge ${esc(link.kind)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${dash}${arrow}/>`,
    );
    if (link.label) {
      parts.push(
        `<text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle">${esc(link.label)}</text>`,
      );
    }
  }

  for (const c of characters) {
    const p = pos(c.id);
    parts.push(
      `<g data-id="${esc(c.id)}"><rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="6"/><text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle">${esc(c.name)}</text></g>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}
