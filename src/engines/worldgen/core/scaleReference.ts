// ============================================
// World Generator — Real places at the same scale
// ============================================
// "How big is this island, really?" A real outline laid over the map at the
// map's own scale answers it at a glance. Outlines come from the bundled
// Natural Earth 1:110m countries (public domain) used by the real atlas; they
// are moved, not resized: every vertex keeps its true distance and bearing from
// the outline's centre, then lands that far from the point the reader is
// looking at on this planet.

import type { Basemap } from '@/engines/real-atlas/basemap';
import { PLANET_RADIUS_KM } from './measure';

export interface ScaleReference {
  id: string;
  /** i18n key: worldgen.scaleRef.<id> */
  countries: string[];
  /** Keep only rings whose bounding box centre lies inside this lon/lat box (drops overseas territories). */
  box?: [number, number, number, number];
}

export const SCALE_REFERENCES: ScaleReference[] = [
  { id: 'iceland', countries: ['Iceland'] },
  { id: 'britainIreland', countries: ['United Kingdom', 'Ireland'] },
  { id: 'iberia', countries: ['Spain', 'Portugal'], box: [-10, 35, 4, 44] },
  { id: 'italy', countries: ['Italy'] },
  { id: 'japan', countries: ['Japan'] },
  { id: 'madagascar', countries: ['Madagascar'] },
  { id: 'newZealand', countries: ['New Zealand'] },
  { id: 'france', countries: ['France'], box: [-6, 41, 10, 52] },
  { id: 'europe', countries: ['Albania', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herz.', 'Bulgaria', 'Croatia', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Kosovo', 'Latvia', 'Lithuania', 'Luxembourg', 'Macedonia', 'Moldova', 'Montenegro', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine', 'United Kingdom'], box: [-25, 34, 41, 72] },
  { id: 'australia', countries: ['Australia'] },
];

const DEG = Math.PI / 180;

/** Rings as [lon, lat] degree pairs, filtered to the reference's own territory. */
export function referenceRings(basemap: Basemap, ref: ScaleReference): number[][][] {
  const rings: number[][][] = [];
  for (const country of basemap.countries) {
    if (!ref.countries.includes(country.name)) continue;
    for (const ring of country.rings) {
      const cx = (ring.minLon + ring.maxLon) / 2, cy = (ring.minLat + ring.maxLat) / 2;
      if (ref.box && (cx < ref.box[0] || cy < ref.box[1] || cx > ref.box[2] || cy > ref.box[3])) continue;
      const pts: number[][] = [];
      for (let i = 0; i < ring.coords.length; i += 2) pts.push([ring.coords[i], ring.coords[i + 1]]);
      rings.push(pts);
    }
  }
  return rings;
}

export interface PlacedReference {
  /** Rings in map units u (continuous, may leave [0,1]) and v. */
  rings: [number, number][][];
  /** Bounding size of the real outline, km. */
  widthKm: number;
  heightKm: number;
}

/**
 * Move the outline so its centre sits at (u, v) of this planet. Each vertex is
 * expressed as local east/north kilometres from the outline's centre on Earth
 * and laid out the same kilometres from the target, so its size is true at the
 * target's latitude whatever the projection then does to it.
 */
export function placeReference(rings: number[][][], u: number, v: number, earthRadiusKm = 6371, planetRadiusKm = PLANET_RADIUS_KM): PlacedReference {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) for (const [lon, lat] of ring) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  const lon0 = (minLon + maxLon) / 2, lat0 = (minLat + maxLat) / 2;
  const targetLat = 90 - v * 180, targetLon = u * 360 - 180;
  const placed = rings.map((ring) => ring.map(([lon, lat]) => {
    const eastKm = earthRadiusKm * (lon - lon0) * DEG * Math.cos(lat * DEG);
    const northKm = earthRadiusKm * (lat - lat0) * DEG;
    const tLat = Math.max(-89.9, Math.min(89.9, targetLat + northKm / (planetRadiusKm * DEG)));
    const tLon = targetLon + eastKm / (planetRadiusKm * DEG * Math.max(0.02, Math.cos(tLat * DEG)));
    return [(tLon + 180) / 360, (90 - tLat) / 180] as [number, number];
  }));
  return {
    rings: placed,
    widthKm: earthRadiusKm * (maxLon - minLon) * DEG * Math.cos(lat0 * DEG),
    heightKm: earthRadiusKm * (maxLat - minLat) * DEG,
  };
}
