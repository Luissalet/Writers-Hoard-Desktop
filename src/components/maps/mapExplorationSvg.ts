import type { MapFog } from './mapExploration';
import { fogPathData } from './mapExploration';

// Fog, trail and party marker as SVG for the exported picture. Self-contained:
// a blur filter and plain shapes, no script, foreignObject or linked resources.

export const FOG_COLOR = '#1b1610';

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);
const round = (value: number): number => Math.round(value * 100) / 100;

/** The fog over a `w` x `h` picture: parchment-dark, soft at the edges. */
export function fogLayerSvg(fog: MapFog, w: number, h: number): string {
  const sigma = round(Math.max(1, w / fog.cols * 0.9));
  return `<defs><filter id="map-fog-soft" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation="${sigma}"/></filter></defs><path data-map-fog="1" d="${fogPathData(fog, w, h, sigma * 3)}" fill="${FOG_COLOR}" filter="url(#map-fog-soft)"/>`;
}

/** The trail the party left (a dashed line and a dot per step, each with its session and date as a tooltip) and the party marker. */
export function partyLayerSvg(fog: MapFog, w: number, h: number): string {
  const px = (x: number, y: number) => `${round(x * w / 100)},${round(y * h / 100)}`;
  const dot = Math.max(3, w / 220);
  const steps = fog.trail.length > 1 ? `<polyline data-map-trail="1" points="${fog.trail.map(step => px(step.x, step.y)).join(' ')}" fill="none" stroke="#e4a853" stroke-width="${round(dot * 0.7)}" stroke-dasharray="${round(dot * 2)} ${round(dot * 1.4)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".9"/>` : '';
  const dots = fog.trail.map(step => `<circle cx="${round(step.x * w / 100)}" cy="${round(step.y * h / 100)}" r="${round(dot)}" fill="#e4a853" stroke="#17191a" stroke-width="1"><title>${escapeXml([step.session, new Date(step.at).toISOString().slice(0, 10)].filter(Boolean).join(' · '))}</title></circle>`).join('');
  const party = fog.party ? `<g data-map-party="1"><circle cx="${round(fog.party.x * w / 100)}" cy="${round(fog.party.y * h / 100)}" r="${round(dot * 3)}" fill="#c4463a" stroke="#f3eedf" stroke-width="2.5"/><circle cx="${round(fog.party.x * w / 100)}" cy="${round(fog.party.y * h / 100)}" r="${round(dot)}" fill="#f3eedf"/></g>` : '';
  return `${steps}${dots}${party}`;
}

/** The fog as a layer of the wiki page: cell units, stretched over the picture with it. `key` makes the filter id unique per map. */
export function fogWikiHtml(fog: MapFog, key: string): string {
  const id = `map-fog-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return `<svg data-map-fog="1" viewBox="0 0 ${fog.cols} ${fog.rows}" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none"><defs><filter id="${id}" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation="0.9"/></filter></defs><path d="${fogPathData(fog, fog.cols, fog.rows, 3)}" fill="${FOG_COLOR}" filter="url(#${id})"/></svg>`;
}

/** The trail (a dashed line and a dot per step, with its session and date) and the party marker over the wiki picture, in percent of it. */
export function partyWikiHtml(fog: MapFog): string {
  const line = fog.trail.length > 1 ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;left:0;top:0;width:100%;height:100%"><polyline points="${fog.trail.map(step => `${round(step.x)},${round(step.y)}`).join(' ')}" fill="none" stroke="#e4a853" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>` : '';
  const dots = fog.trail.map(step => `<span title="${escapeXml([step.session, new Date(step.at).toISOString().slice(0, 10)].filter(Boolean).join(' · '))}" style="position:absolute;left:${round(step.x)}%;top:${round(step.y)}%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#e4a853;border:1px solid #17191a"></span>`).join('');
  const trail = fog.trail.length ? `<div data-map-trail="1" aria-hidden="true" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">${line}${dots}</div>` : '';
  const party = fog.party ? `<span data-map-party="1" aria-label="party" style="position:absolute;left:${round(fog.party.x)}%;top:${round(fog.party.y)}%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#c4463a;border:3px solid #f3eedf;box-shadow:0 0 0 1px #17191a;pointer-events:none"></span>` : '';
  return `${trail}${party}`;
}
