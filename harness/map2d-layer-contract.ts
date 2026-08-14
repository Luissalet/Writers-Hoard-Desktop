import {
  map2DLayerPlan, map2DVectorRiverFallback,
} from '../src/engines/worldgen/cartography/map2dLayers';
import { renderRivers } from '../src/engines/worldgen/core/render';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { getWorld } from './world-cache';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'map2d-layer-contract', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);
const layers = map2DLayerPlan(true);

check('las teselas no se apropian de los caminos', layers.tileLayers.roads === false,
  `roads=${layers.tileLayers.roads}`);
check('el camino principal no depende de cobertura', layers.roadAlpha === 1,
  `alpha=${layers.roadAlpha}`);
check('las ciudades principales no se ceden a la tesela', layers.principalSettlements === true,
  `${geography.settlements.length} ciudades bajo la capa principal`);
check('el río existe en la capa de respaldo', layers.riverFallback,
  `fallback=${layers.riverFallback} · tile=${layers.tileLayers.rivers}`);
check('el tronco no se hornea en teselas ampliables', layers.tileLayers.rivers === false,
  `tile.rivers=${layers.tileLayers.rivers}`);
check('el atlas equirectangular usa respaldo vectorial',
  map2DVectorRiverFallback(true, 'atlas', 'equirect'), 'vector=true');

const riverPixels = renderRivers(world);
let riverInk = 0;
for (let i = 3; i < riverPixels.length; i += 4) if (riverPixels[i] > 0) riverInk++;
check('la capa de río contiene tinta real', world.rivers.length > 0 && riverInk > 0,
  `${world.rivers.length} ríos · ${riverInk} píxeles con agua`);

console.log(failures ? `\n${failures} varas ROJAS` : '\nTODO VERDE');
process.exit(failures ? 1 : 0);
