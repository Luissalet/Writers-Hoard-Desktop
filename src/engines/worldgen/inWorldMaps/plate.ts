import { themeById } from '../cartography/theme';
import { FOG_HIDDEN, FOG_SEEN } from '../core/readerFog';
import { isOpenSea, type RoutePoint } from '../core/tradeRoutes';
import type { WorldData } from '../core/types';
import type { buildKnowledge, cartographerLabels, cartographerRoutes } from './knowledge';
import type { InWorldMap } from './types';

export const PLATE_WIDTH = 1040;
const MARGIN = 30, MAP_Y = 100, MAP_WIDTH = PLATE_WIDTH - MARGIN * 2;
const wrapAt = (x: number, size: number) => ((x % size) + size) % size;
const f = (n: number) => n.toFixed(1);
const xy = (p: RoutePoint) => f(p.x) + ' ' + f(p.y);
export const escapePlateText = (s: string) => s.replace(/[&<>"']/g, ch =>
  ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
);

export function plateProjection(data: WorldData, knowledge: ReturnType<typeof buildKnowledge>, distortion: number) {
  const { width, height } = data;
  const { capital, radius, wrap } = knowledge;
  const left = wrap ? capital.x - width / 2 : 0;
  const mapHeight = Math.max(330, Math.min(690, MAP_WIDTH * height / width));
  const originX = (capital.x - left) / width, originY = capital.y / height;
  const distort = (x: number, y: number) => {
    const strength = distortion * 0.052 * Math.min(1, Math.hypot((x - originX) * width, (y - originY) * height) / (radius * 2));
    return {
      x: x + strength * Math.sin(Math.PI * x) * Math.sin(8 * y + 3 * x),
      y: y + strength * Math.sin(Math.PI * y) * Math.sin(9 * x - 2 * y),
    };
  };
  const project = (x: number, y: number) => {
    const p = distort((x - left) / width, y / height);
    return { x: MARGIN + p.x * MAP_WIDTH, y: MAP_Y + p.y * mapHeight };
  };
  const onSheet = (x: number) => wrap ? left + wrapAt(x - left, width) : x;
  const unproject = (px: number, py: number): RoutePoint | null => {
    const u = (px - MARGIN) / MAP_WIDTH, v = (py - MAP_Y) / mapHeight;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    let x = u, y = v;
    for (let i = 0; i < 10; i++) {
      const p = distort(x, y);
      x += u - p.x; y += v - p.y;
    }
    const cellX = left + Math.max(0, Math.min(0.999999, x)) * width;
    return { x: (wrap ? wrapAt(cellX, width) : cellX) + (data.domain?.bounds.x ?? 0),
      y: Math.max(0, Math.min(0.999999, y)) * height + (data.domain?.bounds.y ?? 0) };
  };
  return { project, unproject, mapHeight, left, onSheet };
}

interface PlateCopy { unknown: string; date: string; origin: string }

export function drawPlate(
  data: WorldData, map: InWorldMap, knowledge: ReturnType<typeof buildKnowledge>,
  routes: ReturnType<typeof cartographerRoutes>, labels: ReturnType<typeof cartographerLabels>, copy: PlateCopy,
) {
  const projection = plateProjection(data, knowledge, map.distortion);
  const { project, mapHeight, left, onSheet } = projection;
  const theme = themeById(map.themeId);
  const height = MAP_Y + mapHeight + MARGIN;
  const { width, height: rows } = data;
  const fine = Math.max(1, Math.ceil(width / 240), Math.ceil(rows / 140));
  const fills = new Map<string, string[]>();
  const coast: string[] = [];
  const append = (color: string, path: string) => {
    const paths = fills.get(color) ?? [];
    paths.push(path);
    fills.set(color, paths);
  };
  interface Blank { x: number; y: number; score: number }
  let blank: Blank | undefined;
  const terrainAt = (x: number, y: number) => {
    x = Math.floor(knowledge.wrap ? wrapAt(x, width) : x);
    y = Math.floor(y);
    const i = y * width + x;
    return { sea: isOpenSea(data, i), lake: data.lake[i] > 0, elevation: data.elevation[i] };
  };
  // Keep the capital in fine ink. A distant sketch uses coarser terrain
  // samples, but the same cells still decide whether it appears on the plate.
  for (let y = 0; y < rows; y += fine) {
    for (let x = left; x < left + width; x += fine) {
      const cx = x + fine / 2, cy = Math.min(rows - 0.01, y + fine / 2);
      const known = knowledge.at(cx, cy);
      if (!known) {
        if (knowledge.at(cx - width / 19, cy) || knowledge.at(cx + width / 19, cy)
          || knowledge.at(cx, cy - rows / 20) || knowledge.at(cx, cy + rows / 20)) continue;
        const score = Math.abs((cx - left) / width - 0.71) + Math.abs(cy / rows - 0.68);
        if ((!blank || score < blank.score) && cx > left + width * 0.16 && cx < left + width * 0.84 && cy > rows * 0.08 && cy < rows * 0.92) blank = { x: cx, y: cy, score };
        continue;
      }
      const dx = cx - onSheet(knowledge.capital.x), dy = cy - knowledge.capital.y;
      const stride = known === FOG_SEEN && Math.hypot(dx, dy) <= knowledge.radius ? fine : fine * (known === FOG_SEEN ? 2 : 4);
      const sampleX = Math.min(left + width - 0.01, left + Math.floor((cx - left) / stride) * stride + stride / 2);
      const sampleY = Math.min(rows - 0.01, Math.floor(cy / stride) * stride + stride / 2);
      // Never pull terrain details from beyond the knowledge boundary.
      const sample = knowledge.at(sampleX, sampleY) ? terrainAt(sampleX, sampleY) : terrainAt(cx, cy);
      const color = sample.lake ? theme.lakes.fill : sample.sea ? theme.ocean.shallow
        : known === FOG_SEEN && sample.elevation > 1.5 ? theme.terrain?.highland ?? theme.mountains.light : theme.land.base;
      const a = project(x, y), b = project(Math.min(left + width, x + fine), y);
      const c = project(Math.min(left + width, x + fine), Math.min(rows, y + fine));
      const d = project(x, Math.min(rows, y + fine));
      append(color + (known === FOG_SEEN ? '|1' : '|0.43'), 'M' + xy(a) + 'L' + xy(b) + 'L' + xy(c) + 'L' + xy(d) + 'Z');
      if (!sample.sea && !sample.lake) {
        if (x > left && knowledge.at(cx - fine, cy) && terrainAt(cx - fine, cy).sea) coast.push('M' + xy(a) + 'L' + xy(d));
        if (x + fine < left + width && knowledge.at(cx + fine, cy) && terrainAt(cx + fine, cy).sea) coast.push('M' + xy(b) + 'L' + xy(c));
        if (y > 0 && knowledge.at(cx, cy - fine) && terrainAt(cx, cy - fine).sea) coast.push('M' + xy(a) + 'L' + xy(b));
        if (y + fine < rows && knowledge.at(cx, cy + fine) && terrainAt(cx, cy + fine).sea) coast.push('M' + xy(d) + 'L' + xy(c));
      }
    }
  }

  const routePaths = routes.map(route => {
    let path = '';
    let previous: RoutePoint | undefined;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let j = i === 1 ? 0 : 1; j <= count; j++) {
        const x = onSheet(a.x + (b.x - a.x) * j / count), y = a.y + (b.y - a.y) * j / count;
        if (knowledge.at(x, y) === FOG_HIDDEN) { previous = undefined; continue; }
        path += (previous && Math.abs(previous.x - x) < width / 2 ? 'L' : 'M') + xy(project(x, y));
        previous = { x, y };
      }
    }
    return `<path d="${path}" fill="none" stroke="${route.sea ? theme.rivers.color : theme.roads.major}" stroke-width="1.25" stroke-dasharray="${route.sea ? '3 4' : '6 3'}"/>`;
  }).join('');

  const occupied: { x: number; y: number; w: number }[] = [];
  const names = labels.flatMap(label => {
    const p = project(onSheet(label.x), label.y);
    const font = label.capital ? 16 : label.known === FOG_SEEN ? 12 : 11;
    const box = { x: p.x + 7, y: p.y - 8, w: label.name.length * font * 0.58 };
    if (box.x + box.w >= MARGIN + MAP_WIDTH || box.y < MAP_Y + 3
        || occupied.some(other => Math.abs(other.y - box.y) < 13 && other.x < box.x + box.w && box.x < other.x + other.w)) return [];
    occupied.push(box);
    const dot = label.settlement ? `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${label.capital ? 4.5 : 2.3}" fill="${label.capital ? theme.settlement.capitalFill : theme.settlement.fill}" stroke="${theme.settlement.ink}"/>` : '';
    return `${dot}<text x="${f(box.x)}" y="${f(p.y - 4)}" font-size="${font}" font-style="${label.settlement ? 'normal' : 'italic'}" paint-order="stroke" stroke="${theme.type.halo}" stroke-width="2">${escapePlateText(label.name)}</text>`;
  }).join('');
  const unknown = blank ? project(blank.x, blank.y) : undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PLATE_WIDTH}" height="${height}" viewBox="0 0 ${PLATE_WIDTH} ${height}">
<rect width="100%" height="100%" fill="${theme.paper.base}"/>
<rect x="12" y="12" width="${PLATE_WIDTH - 24}" height="${height - 24}" fill="none" stroke="${theme.furniture.frame}" stroke-width="2"/>
<g font-family="${escapePlateText(theme.type.body)}" fill="${theme.type.color}">
<text x="520" y="45" text-anchor="middle" font-family="${escapePlateText(theme.type.display)}" font-size="24" ${map.title.length > 65 ? 'textLength="860" lengthAdjust="spacingAndGlyphs"' : ''}>${escapePlateText(map.title)}</text>
<text x="520" y="73" text-anchor="middle" font-size="14">${escapePlateText(copy.origin + ' · ' + copy.date)}</text>
${[...fills].map(([style, paths]) => {
    const [fill, opacity] = style.split('|');
    return `<path d="${paths.join('')}" fill="${fill}" stroke="${fill}" stroke-width="0.32" opacity="${opacity}"/>`;
  }).join('')}
<path d="${coast.join('')}" fill="none" stroke="${theme.coastline.color}" stroke-width="0.6" opacity=".64"/>
${routePaths}
${names}
${unknown ? `<text x="${f(unknown.x)}" y="${f(unknown.y)}" text-anchor="middle" font-style="italic" font-size="16" letter-spacing="2" opacity=".72">${escapePlateText(copy.unknown)}</text>` : ''}
<rect x="${MARGIN}" y="${MAP_Y}" width="${MAP_WIDTH}" height="${mapHeight}" fill="none" stroke="${theme.furniture.frame}"/>
</g></svg>`;
  return { svg, height, unproject: projection.unproject };
}
