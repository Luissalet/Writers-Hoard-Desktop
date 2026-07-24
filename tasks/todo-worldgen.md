# World Generator Engine — Plan (2026-07-24)

Goal: a new `worldgen` engine that procedurally generates plausible planets for
writers — realistic continents, mountain chains, rivers, biomes, and landmark
"geographic accidents" (volcanoes, caves, waterfalls, gorges, hot springs) —
with a 2D atlas map to navigate/waypoint and a 3D terrain view of the same
world. Deterministic from seed + parameters. Chosen over a Unity build so it
lives *inside* Writers Hoard (TypeScript core + canvas 2D + three.js 3D).

## Architecture

- `src/engines/worldgen/core/` — pure TS generation pipeline (no DOM, no React)
  so it runs in a Web Worker: rng → seamless 3D simplex noise on a cylinder
  (east-west wrap) → Voronoi tectonic plates with drift vectors → uplift along
  convergent boundaries → fBm/domain-warp detail → priority-flood + stream-power
  erosion → flow accumulation → rivers/lakes → latitude/altitude temperature →
  wind-band moisture advection (orographic rain, rain shadows) → Whittaker
  biomes → landmark detection → RGBA atlas rendering (hillshaded).
- `src/engines/worldgen/worldgen.worker.ts` — module worker, posts progress,
  transfers typed arrays back.
- Storage philosophy: worlds are stored as **seed + params + waypoints only**
  (deterministic regeneration; in-memory cache per session). Keeps Dexie light.
- Tables (Dexie v19, additive): `generatedWorlds: 'id, projectId, updatedAt'`,
  `worldWaypoints: 'id, projectId, worldId'`.
- Engine registration mirrors `engines/maps`: EngineDefinition + backup
  strategy (simple JSON) + entity resolver (waypoints searchable) + anchor
  adapter. i18n keys in EN + ES.
- 3D: lazy-loaded three.js chunk meshes displaced by the heightmap, textured
  with the atlas render; water plane at sea level; orbit/fly controls; waypoint
  markers; click-on-2D-minimap to jump.
- Integration bonus: "Send to Maps" exports the rendered map as a `worldMaps`
  background image + waypoints as `mapPins`, so the existing Maps engine can
  annotate generated worlds.

## Checklist

- [x] Core: rng, noise, plates, base elevation
- [x] Core: erosion, flow, rivers, lakes
- [x] Core: climate, biomes, landmarks
- [x] Renderer + visual iteration on PNG harness until realistic
- [x] Engine wiring: registry, Dexie v19, hooks, backup, resolver, i18n EN/ES
- [x] 2D map UI: worker+progress, pan/zoom canvas, view modes, overlays,
      waypoints, presets, exports, Send to Maps
- [x] 3D view: meshes, water, controls, exaggeration, waypoints, minimap
- [x] package.json: add `three`, `@types/three`
- [x] Verify: `tsc -b` + `vite build` clean; Playwright run-through of the
      real app (create project → enable engine → generate → 2D/3D → waypoint)
- [x] Review section below filled in

## Review (2026-07-24)

Shipped. 25 new files under `src/engines/worldgen/`, 7 files touched
(`db/index.ts` v19 additive, `engines/index.ts`, `engines/_registry.ts`
suggested lists, both locales, `package.json` + lock for `three`).

Verified end-to-end: `npx tsc -b` clean, `eslint <touched paths>
--max-warnings 0` clean (React Compiler rules — render-adjust pattern used
for prop→state syncs per lesson #17), `vite build` clean with `Terrain3D`
code-split (~551 kB chunk, lazy) and the worker as its own chunk, and a
Playwright run-through of the real dev app: create project → enable engine →
auto-generate (1024×512 ≈ 3-6 s in worker) → atlas/elevation views → place +
edit waypoint → 3D view with fly-to → minimap. Only console noise is Google
Fonts failing in the offline sandbox.

Notable decisions:
- Worlds persist as **seed + params + thumbnail only** (deterministic
  pipeline; regeneration cached in memory per session). Backup = tiny JSON.
- Fluvial erosion runs on a FIFO-optimized priority-flood; flood pop order
  doubles as the accumulation order (no per-iteration sort).
- Ocean–continent subduction places the cordillera *inland* of the trench;
  ancient interior belts keep continents interesting away from margins.
- Landmarks derive from simulation state (convergence → volcanoes/springs,
  karst ∩ rain ∩ relief → caves, river steps → waterfalls/gorges).
- 2D map bakes hillshade; 3D uses the unshaded composite + real lights.

Known small caveat: dev harness under `harness/` needs `npm i -D tsx
playwright-core` if you want to run it (deliberately not in package.json).

Follow-ups (future sessions): terrain painting/editing layers, per-region
zoom regeneration, named label layer, sea ice & glaciers flow, cave
cross-section maps.

## Update (2026-07-24, same day): projections + 3D shapes

- 2D map projections via `core/projections.ts` (pure forward/inverse math +
  cached nearest-neighbour index maps for pixel reprojection): equirect,
  Mercator (±82° clamp), Robinson (classic tables), Mollweide, and a polar
  azimuthal "Disco polar" (north pole centred). Overlays forward-project,
  clicks/hover inverse-project, graticule renders as sampled polylines so it
  curves correctly; wrap-around panning only for the cylindrical two. PNG
  export honours the active projection.
- 3D shapes in Terrain3D: Plano (flat slab), Globo (displaced sphere,
  circumference = map width), and Disco (Mundodisco-style disc on a pedestal,
  north pole at the centre — matches the 2D azimuthal). One generalized
  surface mapping with precomputed angle tables + numeric normals; per-shape
  water bodies, camera presets, fly-to and minimap indicators; waypoint pins
  orient radially on the globe.
- Gotcha worth remembering: on the globe/disc the angular parameterization
  mirrors the grid's handedness — triangles wound backwards and the terrain
  was backface-culled to invisibility. Negating the longitude direction
  restores plane-identical winding AND is the cartographically correct
  east-to-the-right orientation seen from outside.
- Verified: tsc/eslint/build clean; Playwright pass extended with Mollweide,
  polar-disc, Robinson, Globe and Disc screenshots — all rendering correctly.

## Update 2 (2026-07-24): generation-quality rework (user feedback)

Feedback: single supercontinent almost always; biomes in latitude stripes;
wants more resolution and more varied geography. Changes:

- **Continent variety**: continental plate COUNT now follows landRatio and
  PLACEMENT follows a new `continentClustering` param (0 = scattered, 1 =
  pangaea; exposed as a slider + per-preset). Interior/plateau noise raised
  in frequency + lowered in amplitude (the old ultra-low-freq shared field
  was welding all land into one blob), epeiric basins can flood into inland
  seas, continental rifts tuned to hold elongated rift lakes.
- **Geographic features**: hotspot island chains (2–4 trails, decaying
  height), oceanic microcontinents (2–4 ragged noise-modulated blobs),
  two-scale boundary warp for intricate coastlines.
- **Biomes**: temperature anomalies (broad + fine, amplified toward poles so
  ice edges meander), continentality (interiors colder at high lat / hotter
  in tropics, derived from residual advected humidity), regional wet/dry
  rain multiplier, stronger broad biome dither. Ice-cap threshold −13 °C.
- **Resolution**: options now 768 / 1536 / 2560 (default 1536). Erosion
  iterations scale down at high res but upliftScale compensates (total
  uplift constant — mountains no longer shrink with resolution). 3D mesh
  max-pool downsamples above 1536 so vertex count stays ~1.2M; height scale
  made resolution-independent. `normalizeParams()` backfills old saved
  worlds; projection index-map cache bounded (high-res maps are ~26 MB).
- Perf gotcha fixed: the exaggeration effect re-ran a full ~1.2M-vertex
  height pass on mount (and again under StrictMode) — now guarded by
  `appliedExag`.
- Verified: tsc/eslint/build clean; harness across seeds/presets shows
  multiple separated continents by default and a proper pangaea at
  clustering 0.95; live E2E green.
