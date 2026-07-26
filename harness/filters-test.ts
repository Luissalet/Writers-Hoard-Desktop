import { generateWorld } from '/root/wg/src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '/root/wg/src/engines/worldgen/core/types';
import { DEFAULT_FILTERS } from '/root/wg/src/engines/worldgen/core/generation';
import { buildHumanGeography } from '/root/wg/src/engines/worldgen/core/settlements';
const run = (label: string, filters: any) => {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 'monstruo', width: 512, filters });
  const g = buildHumanGeography(w);
  const kinds = new Set(g.ruins.map((r) => r.kind));
  const lf = new Set(g.landforms.map((l) => l.kind));
  console.log(`${label.padEnd(32)} ${String(g.ruins.length).padStart(3)} ruinas (${[...kinds].join(',') || '—'}) · ${g.landforms.length} accidentes (${[...lf].join(',') || '—'})`);
};
run('por defecto', DEFAULT_FILTERS);
run('sin torres ni templos', { ...DEFAULT_FILTERS, ruinKinds: { tower: false, temple: false } });
run('sin cumbres ni puertos', { ...DEFAULT_FILTERS, ruinSites: { summit: false, harbour: false } });
run('ruinas ×0', { ...DEFAULT_FILTERS, ruinDensity: 0 });
run('ruinas ×3', { ...DEFAULT_FILTERS, ruinDensity: 3 });
run('sin cabos ni bahías', { ...DEFAULT_FILTERS, landforms: { cape: false, bay: false, fjord: false } });
