# Investigación — Cities
> Recopilado automáticamente durante la sesión del 2026-07-24 para el motor `worldgen` de Writers Hoard.


---

<!-- fuente: city-mfcg-opensource.md -->

I have the complete ground truth. Writing up now.

---

# Procedurally Generating an MFCG-Grade Medieval City — Implementation Report

**Primary source: the actual Haxe source, cloned and read line-by-line** from [github.com/watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) (GPL-3.0 — algorithms and constants are not copyrightable; reimplement, don't copy text). Everything marked **[OS]** is verbatim from that code. Everything marked **[MFCG]** is from the current closed build, recovered from [watabou.github.io/city-generator/mfcg.js](https://watabou.github.io/city-generator/mfcg.js) (minified but retains class names, string literals and `.hx` metadata) and the [itch.io devlogs](https://watabou.itch.io/medieval-fantasy-city-generator/devlog).

---

## 0. The one architectural decision you must make first

**[OS] The entire algorithm depends on Voronoi cell vertices being *shared mutable `Point` objects*.** `Patch.fromRegion` stores `tr.c` — the circumcenter `Point` of a `Triangle`, and the *same* `Triangle` instance appears in every adjacent region's vertex list. So `Polygon.contains(v)` is `indexOf(v) != -1` — **reference identity, not geometric containment**. That identity *is* the topology:

- `optimizeJunctions` does `v0.addEq(v1); v0.scaleEq(0.5)` — moving a junction for every patch at once.
- `CurtainWall` does `shape.set([...smoothed])` → `this[i].set(p[i])` — smoothing the wall physically drags the patch vertices with it.
- `Topology` maps `Point → Node` in a `Map<Point,Node>` keyed by identity.
- `Model.findCircumference` finds the union outline by looking for directed edges `(a,b)` with no reverse twin `(b,a)`.

In TypeScript, **do not** try to reproduce this with object identity plus `Array.indexOf` (O(n) scans everywhere, and `Point` equality becomes a footgun). Use an explicit indexed mesh:

```ts
interface Mesh {
  vx: Float64Array; vy: Float64Array;          // vertex positions, index = vertex id
  patchVerts: number[][];                      // patch -> CCW vertex ids
  vertPatches: number[][];                     // vertex -> incident patch ids
  edgeType: Map<number, EdgeKind>;             // key = (min<<20)|max, kind = WALL|COAST|ROAD|CANAL|NONE
}
```
Moving a vertex = writing `vx[i]`. Shared-topology semantics come free, `contains` is O(1), and you get the edge-tagging that **[MFCG]** later needs (§7). This is the single highest-value deviation from the original.

---

## 1. Point / patch generation

### 1.1 The seeding spiral **[OS]** — `Model.buildPatches`

```haxe
var sa = Random.float() * 2 * Math.PI;
var points = [for (i in 0...nPatches * 8) {
    var a = sa + Math.sqrt(i) * 5;
    var r = (i == 0 ? 0 : 10 + i * (2 + Random.float()));
    new Point(Math.cos(a) * r, Math.sin(a) * r);
}];
```

Exactly `8 × nPatches` seeds. **Not** Poisson, **not** blue noise, **not** jittered grid.

**Why it works — I verified this analytically and numerically.** With `E[2 + rand] = 2.5`, `r(i) ≈ 10 + 2.5i` and `a(i) = a₀ + 5√i`:

| | formula | at i=40 | i=100 | i=300 |
|---|---|---|---|---|
| along-arm spacing `r·da/di` | `2.5i · 5/(2√i) = 6.25√i` | 43.5 | 65.0 | 109.7 |
| adjacent-arm separation `2.5·Δi_turn`, `Δi_turn ≈ 2.51√i` | `6.28√i` | 43.7 | 66.8 | 112.8 |
| **ratio** | **≈ 1.00** | 1.00 | 0.97 | 0.97 |

The spiral is **quasi-isotropic**: local cell size ≈ `6.25√i ≈ 4√r`. Cells are small at the centre and grow as the *square root* of radius. That single property is why MFCG maps have a dense core and coarse outskirts without any density function. Replicate the formula exactly; do not "improve" it with Poisson sampling or you lose the gradient.

Resulting extents (measured): `nPatches=15` → 120 seeds, `rMax ≈ 340`; `nPatches=40` → 320 seeds, `rMax ≈ 910`.

### 1.2 Sizes **[OS]** (`TownScene`, `StateManager`)

| Label | nPatches |
|---|---|
| Small Town | 6–10 |
| Large Town | 10–15 |
| Small City | 15–24 |
| Large City | 24–40 |
| Metropolis | ≥40 |

Default 15. URL clamp `6 ≤ size ≤ 40`.

**[MFCG]** current: `small {10,20}`, `medium {20,40}`, `large {40,80}`, custom `5…200`, default 25. Devlog [0.10.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha): *"Medium cities are made of 20-40 patches instead of 12-25 as before."*

**Scale anchor [MFCG]:** 1 map unit = **4 metres** (JSON export `SCALE=4`; `roadWidth: 8` for `MAIN_STREET = 2.0`). So `MAIN_STREET` = 8 m, `REGULAR_STREET` = 4 m, `ALLEY` = 2.4 m, tower radius 1.8 u = 7.2 m. Use this to sanity-check every constant below.

### 1.3 Voronoi **[OS]**

Bowyer–Watson incremental Delaunay (`Voronoi.hx`), regions = circumcenters of incident triangles, sorted CCW by angle about the seed. A bounding frame of **4 corner points** is inserted first at `[minx − dx/2, miny − dy/2, maxx + dx/2, maxy + dy/2]` where `dx,dy` are half the point-cloud extents. `partioning()` returns only regions none of whose triangles touch a frame point — i.e. it **drops the convex-hull ring of seeds**.

**[MFCG]** replaced this with a port of [Delaunator](https://github.com/mapbox/delaunator) in 0.7.3. Do the same — use `delaunator` from npm, build the dual yourself.

### 1.4 Lloyd relaxation — **this is broken in the original; fix it**

```haxe
for (i in 0...3) {
    var toRelax = [for (j in 0...3) voronoi.points[j]];
    toRelax.push( voronoi.points[nPatches] );
    voronoi = Voronoi.relax( voronoi, toRelax );
}
```

`voronoi.points[0..3]` are the **four frame corners**, not city seeds. `Voronoi.relax` only relaxes points that are seeds of *real* regions, and frame points never are. So `points[0],[1],[2]` are no-ops, and `points[nPatches]` is actually seed index `nPatches − 4`. **The comment says "Relaxing central wards"; the code relaxes exactly one non-central point, three times.** It is effectively a no-op.

For TypeScript: either drop it entirely (**[MFCG]** did) or do it properly — 1–2 Lloyd iterations over seeds `0…nPatches` only. Note **[MFCG]** instead *hard-codes the plaza*: seeds 1–4 are overwritten with a rectangle `polar(f,a₀), polar(h,a₀+π/2), polar(f,a₀+π), polar(h,a₀+3π/2)`, `f = 8+8·rnd`, `h = f(1+rnd)` — that's what forces the central plaza to be roughly rectangular. **Steal this; it's better than relaxation.**

Also consider Amit Patel's fix: build cells from **centroids rather than circumcenters** ([redblobgames Voronoi tutorial](https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/)) — eliminates the degenerate spikes that cause Watabou's `"Bad citadel shape!"` retries.

### 1.5 Inner-city selection **[OS]**

```haxe
voronoi.points.sort((p1,p2) -> sign(p1.length - p2.length));  // by |p| from origin
var regions = voronoi.partioning();                            // iterates points in that order
count = 0;
for (r in regions) {
    patch = Patch.fromRegion(r); patches.push(patch);
    if (count == 0) {
        center = patch.shape.min(p -> p.length);   // ← a VERTEX, not the centroid
        if (plazaNeeded) plaza = patch;
    } else if (count == nPatches && citadelNeeded) {
        citadel = patch; citadel.withinCity = true;
    }
    if (count < nPatches) { patch.withinCity = true; patch.withinWalls = wallsNeeded; inner.push(patch); }
    count++;
}
```

- `inner` = the `nPatches` regions **closest to the origin**. Because `r(i)` is monotonic in `i`, sorting is nearly a no-op — it just cleans up the `(2+rand)` jitter.
- **`center` is a vertex of patch 0**, deliberately: it must be a node in the street graph so A* can target it.
- The citadel is region index `nPatches` — the first patch *outside* the inner ring, so the castle sits tangent to the wall. This matches real urban castles ([Urban castle](https://en.wikipedia.org/wiki/Urban_castle)).
- `plazaNeeded`, `citadelNeeded`, `wallsNeeded` are three independent 50% coin flips.

**[MFCG]** probabilities are now size-driven: `walls = (s+30)/80`, `citadel = 0.5 + s/100`, `plaza = 0.9`, `temple = s/18`, `river = 2/3`, `coast = 0.5`, `shanty = s/80`.

### 1.6 Junction cleanup **[OS]** — `optimizeJunctions`

Merge any two consecutive vertices of an inner/citadel patch closer than **8 world units** (= 32 m): rewrite `v1 → v0` in every other patch that shares `v1`, set `v0 = (v0+v1)/2`, remove `v1`. Then dedupe. This kills the micro-edges Voronoi always produces and is what makes street junctions read as junctions.

**[MFCG]** threshold is now `max(3·LTOWER_RADIUS, perimeter/n/3)` = `max(7.5, …)`.

---

## 2. Walls

### 2.1 The wall polygon **[OS]** — `Model.findCircumference`

Union outline of the inner patches, found combinatorially, not geometrically:

```ts
function findCircumference(wards: Patch[]): Polygon {
  if (!wards.length) return [];
  if (wards.length === 1) return wards[0].shape.slice();
  const A: V[] = [], B: V[] = [];
  for (const w1 of wards)
    forEdge(w1.shape, (a, b) => {
      // an edge is on the outline iff NO other ward has the reverse edge (b,a)
      if (!wards.some(w2 => findEdge(w2.shape, b, a) !== -1)) { A.push(a); B.push(b); }
    });
  const result: V[] = []; let idx = 0;
  do { result.push(A[idx]); idx = A.indexOf(B[idx]); } while (idx !== 0);
  return result;
}
```
All patches CCW ⇒ every interior edge appears twice with opposite direction. Boundary edges appear once. Chain them by `A[next] === B[cur]`. **O(n²) as written — index edges in a hash map keyed `(a,b)` for O(n).**

### 2.2 Wall smoothing **[OS]**

```haxe
var smoothFactor = Math.min(1, 40 / patches.length);
shape.set([for (v in shape) reserved.contains(v) ? v : shape.smoothVertex(v, smoothFactor)]);
```
with `smoothVertex(v, f) = (prev + v·f + next) / (2 + f)`.

`f = 1` for ≤40 inner patches (maximal smoothing: `(prev+v+next)/3`); less smoothing for bigger cities. `reserved` = the citadel's vertices, which are pinned. **This mutates shared `Point`s, so the wall smoothing drags the adjacent patches' geometry with it** — that's why walls never cut through wards.

### 2.3 Gates **[OS]** — `CurtainWall.buildGates`

Candidate entrances = wall vertices that are **not reserved** and are **shared by more than one inner patch** (`patches.count(p => p.shape.contains(v)) > 1`). Rationale from the source comment: *"so that a street could connect it to the city center."* If a wall has a single patch, all non-reserved vertices qualify.

```
if entrances.length == 0: throw "Bad walled area shape!"   // regenerate whole city
do {
    index = randInt(0, entrances.length)
    gate  = entrances[index]; gates.push(gate)
    ... (outer-patch split, below) ...
    // remove the gate AND its two neighbours so gates can't be adjacent
    if (index == 0)                      { entrances.splice(0,2); entrances.pop(); }
    else if (index == entrances.length-1){ entrances.splice(index-1,2); entrances.shift(); }
    else                                 { entrances.splice(index-1,3); }
} while (entrances.length >= 3)
```
⇒ **gate count ≈ ⌊|entrances| / 3⌋**, and no two gates are within 2 wall vertices of each other.

**Outer-patch split (important, easy to miss):** if the gate has exactly *one* patch outside the walls and that patch has >3 vertices, the outer patch is **split in two** along `gate → farthest`, where

```haxe
wall = shape.next(gate) − shape.prev(gate);
out  = new Point(wall.y, −wall.x);                  // outward normal
farthest = outer.shape.max(v =>
    (shape.contains(v) || reserved.contains(v)) ? −∞
    : dot(v − gate, out) / |v − gate|);             // most outward-facing direction
```
Without this, a road leaving the gate would have no vertex to route through. `Polygon.split(p1,p2)` slices the vertex ring at two indices.

Finally each gate is smoothed once more: `gate.set(shape.smoothVertex(gate))`.

**[MFCG]** adds explicit control: `gates=N` for exact count, `gates=0` for gateless, `hub=1` for one gate per wall vertex; default count `2 + floor(nInner/12 · (coast ? 0.75 : 1))`, chosen by weighted random with a circular-distance repulsion `n[h] *= (d<=1 ? 0 : d-1)`.

### 2.4 Towers **[OS]**

```haxe
for (i in 0...len) {
    var t = shape[i];
    if (!gates.contains(t) && (segments[(i+len-1)%len] || segments[i])) towers.push(t);
}
```
**Every non-gate wall vertex is a tower.** `segments[]` is an all-`true` array in the OS build — the flag exists so **[MFCG]** can delete wall runs along the shore (devlog [0.4.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/4923/040-coastal-cities): *"The section of the city wall which borders the water is removed to provide the city access to the shore"*). Implement `segments: boolean[]` from day one.

Reality check for tuning ([Ávila](https://en.wikipedia.org/wiki/Walls_of_%C3%81vila) 88 towers / 2516 m = 28.6 m; [York](https://en.wikipedia.org/wiki/York_city_walls) 87 m; [Nuremberg](https://en.wikipedia.org/wiki/City_walls_of_Nuremberg) ~38 m): **tower spacing 30–60 m**, gate spacing **250–350 m** dense or **700–850 m** for the English 4-bar pattern. At 4 m/unit, Watabou's wall vertices land naturally in that band for mid-size cities.

### 2.5 The citadel wall **[OS]** — `Castle`

```haxe
wall = new CurtainWall(true, model, [patch],
    patch.shape.filter(v => model.patchByVertex(v).some(p => !p.withinCity)));
```
A one-patch curtain wall whose `reserved` set is *every citadel vertex touching a non-city patch*. Since reserved vertices can't be gates, **the castle's gates all face into the city**. Then `citadel.shape.compactness < 0.75` ⇒ `throw "Bad citadel shape!"` ⇒ full regeneration. (`compactness = 4π·area/perimeter²`: circle 1.00, square 0.79, triangle 0.60.)

Real urban castles have **exactly two** gates — one to the fields, one to the town. Add that.

### 2.6 No-wall cities **[OS]**

`border = new CurtainWall(false, ...)` is still constructed — you always need the outline and gates for street routing. What changes when `wallsNeeded == false`:

| | walled | unwalled |
|---|---|---|
| `model.wall` | `= border` | `null` |
| `patch.withinWalls` | `true` | `false` |
| smoothing / gate smoothing | applied | skipped |
| towers | built | none |
| outer-patch split at gates | done | skipped |
| block inset (`getCityBlock`) | `MAIN_STREET/2` on wall edges | n/a |
| GateWard probability | 0.5 | **0.2** |
| outskirts pass | runs | skipped |
| `isEnclosed(p)` | `withinWalls` ⇒ true | needs *all* neighbours in-city |

That last row is the visual payoff: unwalled cities get `filterOutskirts()` applied to far more wards, so they fade into the countryside instead of stopping at a line. Devlog [0.3.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/3091/030-wall-less-layouts-city-outskirts-smooth-roads).

Also: after walls, `patches = patches.filter(p => p.shape.distance(center) < border.getRadius() * 3)` — the world is culled to 3× the wall radius.

---

## 3. Streets

### 3.1 The topology graph **[OS]** — `Topology.hx`

- **Nodes = patch polygon vertices** (deduped by identity).
- **Edges = patch polygon edges**, cost = **Euclidean length**. Nothing else. No turn penalty, no terrain.
- `blocked` = `citadel.shape ∪ wall.shape` **minus** `gates`. Blocked points get `processPoint → null`, so they're registered in the maps but never linked ⇒ **streets cannot run along or through a wall except at a gate.**
- Two node sets partition the graph: `inner` (vertices of in-city patches) and `outer` (vertices of countryside patches), both **excluding vertices on `border.shape`** — so border vertices belong to neither and act as the permeable seam.

### 3.2 Routing **[OS]** — `Model.buildStreets`

```haxe
for (gate in gates) {
    end = plaza != null ? plaza.shape.min(v => dist(v, gate))   // nearest plaza corner
                        : center;                                // the central vertex
    street = topology.buildPath(gate, end, topology.outer);      // EXCLUDE outer nodes
    if (street == null) throw "Unable to build a street!";
    streets.push(street);

    if (border.gates.contains(gate)) {                            // not castle gates
        dir   = gate.norm(1000);                                  // 1000 units radially outward
        start = argmin over topology.node2pt of dist(p, dir);     // nearest node to that far point
        road  = topology.buildPath(start, gate, topology.inner);   // EXCLUDE inner nodes
        if (road != null) roads.push(road);
    }
}
```
The exclusion sets are the whole trick: **streets are forced to stay inside the city, roads are forced to stay outside.** `exclude` is passed as A*'s pre-seeded closed set.

**`Graph.aStar` is not A\*** — it's Dijkstra with `openSet.shift()` (FIFO, no priority queue, no heuristic), and it never re-opens closed nodes. Replace with a real binary-heap A* using Euclidean `h`. Also note `buildPath` returns the path **goal→start** (`buildPath` pushes ancestors), so gate-to-plaza streets come back reversed — irrelevant after `tidyUpRoads`, but relevant if you keep ordered paths.

### 3.3 Deduplication into arteries **[OS]** — `tidyUpRoads`

```
segments = []
for each street and road:
    for each consecutive (v0,v1):
        if plaza != null and plaza.shape.contains(v0) and plaza.shape.contains(v1): continue  // no street along the plaza rim
        if no existing seg with (start==v0 && end==v1): segments.push(Segment(v0,v1))

arteries = []
while segments not empty:
    seg = segments.pop()
    attach to an artery whose head == seg.end (unshift start) or whose tail == seg.start (push end)
    else start a new artery [seg.start, seg.end]
```
Result: maximal non-duplicated polylines. **Note the greedy single-pass join never merges two arteries that later become joinable** — a real weld pass (join arteries whose endpoints coincide, repeat to fixpoint) gives visibly better long streets.

### 3.4 Smoothing **[OS]**

```haxe
for (a in arteries) {
    var smoothed = a.smoothVertexEq(3);
    for (i in 1...a.length-1) a[i].set(smoothed[i]);   // endpoints PINNED
}
```
`smoothVertexEq(f)` = `v'ᵢ = (vᵢ₋₁ + f·vᵢ + vᵢ₊₁)/(2+f)`, so with `f = 3`: **`v'ᵢ = (vᵢ₋₁ + 3vᵢ + vᵢ₊₁)/5`**, one pass. Because it writes into the shared `Point`s, **smoothing a street also deforms every patch that touches it** — the wards bend around the street. This is essential to the look; do not smooth a copy.

Rendering uses `Spline.curvature = 0.1` for quadratic control points:
```
startCurve(p0,p1,p2): control = p1 − 0.1·(p2−p0)
midCurve(p0,p1,p2,p3): p1a = p1 + 0.1·(p2−p0);  p2a = p2 − 0.1·(p3−p1);  p12 = (p1a+p2a)/2
endCurve(p0,p1,p2):   control = p1 + 0.1·(p2−p0)
```
**[MFCG]** now uses Chaikin (`smoothOpen`) instead.

### 3.5 Widths **[OS]** — `Ward.hx`

```haxe
MAIN_STREET = 2.0;   REGULAR_STREET = 1.0;   ALLEY = 0.6;   // = 8 m / 4 m / 2.4 m
```

**Streets are never rendered as polygons.** They are (a) stroked polylines for `roads`, and (b) — for everything inside the city — **negative space produced by insetting each ward by half the street width** (§5.1). That's the key idea: you don't widen a centreline into a ribbon, you shrink the blocks away from it. Guarantees no self-intersection, no overlap, and correct junction geometry for free.

`drawRoad` renders roads as **two overlaid strokes** — width `MAIN_STREET + 0.3 = 2.3` in `medium`, then `MAIN_STREET − 0.3 = 1.7` in `paper` — producing a paper-coloured ribbon with a thin casing.

For reference against reality ([Designing Buildings](https://www.designingbuildings.co.uk/wiki/The%20history%20of%20the%20dimensions%20and%20design%20of%20roads,%20streets%20and%20carriageways), bastide data): market street 15–23 m, main 6–10 m, secondary 5–6 m, *venelle* 1–3 m, *androne* firebreak 0.25–0.40 m. Watabou's 8/4/2.4 m sits right.

---

## 4. Wards

### 4.1 The deck **[OS]** — `Model.WARDS`, 36 entries

`CraftsmenWard ×21, Slum ×5, MerchantWard ×2, PatriciateWard ×2, Market ×2, Cathedral ×1, AdministrationWard ×1, MilitaryWard ×1, Park ×1`

Shuffled by only `⌊36/10⌋ = 3` adjacent swaps (`wards[i] ↔ wards[i+1]`), then consumed with `shift()`. **Once the deck runs out, every remaining patch becomes `Slum`** — so cities above ~36 patches are mostly slum. Fix this: use a weighted multinomial with per-type caps, or **[MFCG]**'s district approach (§4.5).

### 4.2 Assignment loop **[OS]** — `createWards`

```
unassigned = inner.copy()
if plaza:  plaza.ward = Market;  unassigned.remove(plaza)

// gate wards first
for gate in border.gates:
  for patch in patchByVertex(gate):
    if patch.withinCity && patch.ward == null && Random.bool(wall == null ? 0.2 : 0.5):
        patch.ward = GateWard; unassigned.remove(patch)

while unassigned:
    wardClass = deck.shift() ?? Slum
    rate = static rateLocation on wardClass
    bestPatch = rate == null ? random unassigned patch
                             : argmin over unassigned of rate(model, patch)   // LOWEST wins
    bestPatch.ward = new wardClass(...); unassigned.remove(bestPatch)
```

**Haxe statics are not inherited**, so `Reflect.field(cls,"rateLocation")` returns `null` for `CraftsmenWard`, `GateWard`, `Park`, `Farm`, `CommonWard`. **Those get uniformly random patches.** Only these score (minimum wins):

| Ward | `rateLocation(model, patch)` |
|---|---|
| Merchant | `dist(patch, plaza.center ?? center)` — hug the centre |
| Slum | `−dist(patch, plaza.center ?? center)` — maximise distance |
| Administration | `borders(plaza) ? 0 : dist(patch, plaza.center)` |
| Cathedral | `borders(plaza) ? −1/area : dist(patch, plaza.center) · area` |
| Market | `+∞` if adjacent to another Market; else `area / plaza.area` |
| Military | `0` if borders citadel; `1` if borders wall; else `+∞` (`0` if neither exists) |
| Patriciate | `Σ neighbours: −1 per Park, +1 per Slum` |

**Bug you must not port:** `Polygon.distance(p)` never updates its accumulator —

```haxe
public function distance( p:Point ):Float {
    var v0 = this[0];
    var d = Point.distance( v0, p );
    for (i in 1...this.length) {
        var v1 = this[i];
        var d1 = Point.distance( v1, p );
        if (d1 < d) v0 = v1;      // ← updates v0 but NOT d
    }
    return d;                     // ← always distance from vertex[0]
}
```
It returns the distance to the polygon's **first vertex**, not the minimum. Every distance-based `rateLocation` above is therefore substantially noisier than intended. Fix it (`d = d1`) and the Merchant/Slum radial sorting becomes visibly cleaner.

### 4.3 Ward constructor parameters **[OS]** (`r ≡ Random.float()`, fresh draw per occurrence)

| Ward | `minSq` | `gridChaos` | `sizeChaos` | `emptyProb` |
|---|---|---|---|---|
| Craftsmen | `10 + 80·r·r` | `0.5 + 0.2r` | 0.60 | 0.04 |
| Merchant | `50 + 60·r·r` | `0.5 + 0.3r` | 0.70 | **0.15** |
| Patriciate | `80 + 30·r·r` | `0.5 + 0.3r` | 0.80 | **0.20** |
| Administration | `80 + 30·r·r` | `0.1 + 0.3r` | 0.30 | 0.04 |
| Slum | `10 + 30·r·r` | `0.6 + 0.4r` | 0.80 | 0.03 |
| Gate | `10 + 50·r·r` | `0.5 + 0.3r` | 0.70 | 0.04 |
| Military | `√(block.area)·(1+r)` | `0.1 + 0.3r` | 0.30 | **0.25** |

`r·r` (product of two independent uniforms) is deliberate — it biases hard toward the low end, so most Craftsmen wards have `minSq ≈ 10–25` (small houses) with a long tail to 90. Note `Military` derives `minSq` from the block itself, giving a handful of big barracks blocks regardless of ward size.

Non-`CommonWard` wards:

- **Cathedral**: `Random.bool(0.4) ? Cutter.ring(block, 2 + 4r) : createOrthoBuilding(block, 50, 0.8)`
- **Park**: `block.compactness ≥ 0.7 ? Cutter.radial(block, null, ALLEY) : Cutter.semiRadial(block, null, ALLEY)`
- **Market**: statue with p=0.6 (a `rect(1+r, 1+r)` rotated to the longest edge) else a 16-gon `circle(1+r)`; offset if statue or `Random.bool(0.3)`, to `interpolate(centroid, midpoint(longest edge), 0.2 + 0.4r)`, else centroid.
- **Castle**: `patch.shape.shrinkEq(MAIN_STREET*2 = 4)` then `createOrthoBuilding(block, √(block.area)·4, 0.6)`
- **Farm**: a `rect(4,4)` placed at `interpolate(random vertex, centroid, 0.3 + 0.4r)`, rotated `r·π`, then `createOrthoBuilding(housing, 8, 0.5)`

### 4.4 Countryside **[OS]**

```haxe
cityRadius = max |v| over all vertices of all withinCity patches
for patch in patches where !withinCity && ward == null:
    ward = (Random.bool(0.2) && patch.shape.compactness >= 0.7) ? Farm : Ward   // Ward = empty
```
Plus the outskirts pass: for each wall gate, with probability `1 − 1/(nPatches−5)`, every ward-less patch at that gate is promoted to `withinCity` + `GateWard`. That's the only suburb mechanism in the OS build.

### 4.5 **[MFCG]** — the taxonomy was deleted

The socio-economic wards are **gone**. String-scanning `mfcg.js` finds zero hits for `Slum`, `Craftsmen`, `Merchant`, `Patriciate`, `Military`, `Administration`. Current ward classes: `Alleys` (the single generic urban ward), `Castle`, `Cathedral`, `Market`, `Park`, `Harbour`, `Farm`, `Wilderness`, `WardGroup`. Only three return a hard label; everything else returns `patch.district.name`.

Semantics moved up to a **`DistrictType` enum**: `CENTER | CASTLE | DOCKS | BRIDGE | GATE | BANK | PARK | SPRAWL | REGULAR`. `DistrictBuilder` seeds one district per prominent feature (citadel gate, plaza, each park, each wall gate, each bridge, two river-side cells, first landing cell), tops up randomly to `floor(√nCityCells)` districts, then flood-grows each with a per-type rate (`CASTLE/BRIDGE/GATE = 0.1`, `BANK = 0.5`, else `1.0`), **refusing to cross `WALL` or `CANAL` edges** and damping `0.9` across `ROAD` edges. Devlog [0.7.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/85275/070-districts).

Per-district shape parameters (this is what makes districts look different):
```
minSq       = 15 + 40·|avg4(r)·2 − 1|    → [15, 55)
gridChaos   = 0.2 + avg3(r)·0.8          → [0.2, 1.0)
sizeChaos   = 0.4 + avg3(r)·0.6          → [0.4, 1.0)
shapeFactor = 0.25 + avg3(r)·2           → [0.25, 2.25)
inset       = 0.6·(1 − |avg4(r)·2 − 1|)  → [0, 0.6]
blockSize   = 4 + 10·avg3(r)             → [4, 14)
minFront    = √minSq
greenery    = avg3(r)^(type==PARK ? 1 : 2)
if SPRAWL:  gridChaos *= 0.5;  blockSize *= 2;  greenery = (1+greenery)/2
```

**Recommendation:** implement the district layer. Keep the OS ward *names* as flavour labels driven by district type + distance-to-centre, but drive *geometry* from per-district parameters. You get MFCG's look and D&D-usable labels.

---

## 5. Building subdivision

### 5.1 Ward → block **[OS]** — `Ward.getCityBlock`

```haxe
insetDist = [];
innerPatch = (model.wall == null || patch.withinWalls);
patch.shape.forEdge((v0, v1) -> {
    if (model.wall != null && model.wall.bordersBy(patch, v0, v1))
        insetDist.push(MAIN_STREET / 2);                      // 1.0 — clear of the wall
    else {
        onStreet = innerPatch && plaza != null && plaza.shape.findEdge(v1, v0) != -1;
        if (!onStreet)
            onStreet = arteries.some(s => s.contains(v0) && s.contains(v1));
        insetDist.push((onStreet ? MAIN_STREET : (innerPatch ? REGULAR_STREET : ALLEY)) / 2);
    }
});
return patch.shape.isConvex() ? patch.shape.shrink(insetDist)
                              : patch.shape.buffer(insetDist);
```

Per-edge inset, half the street width: **1.0** on wall / artery / plaza-facing edges, **0.5** on other inner edges, **0.3** outside. Two adjacent patches each inset by half ⇒ the gap between them *is* the street. Note the reversed-edge lookup `plaza.shape.findEdge(v1, v0)` — the plaza's edge runs the other way from the neighbour's.

`isConvex()` picks the cheap `shrink` (half-plane clipping) and falls back to `buffer` (offset + self-intersection resolution) for concave blocks. See §6.

### 5.2 `Ward.createAlleys` — the recursive subdivider **[OS]**

```
createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb = 0.04, split = true) -> Polygon[]:

  1. v ← start vertex of the LONGEST edge of p
  2. spread ← 0.8 · gridChaos
     ratio  ← (1 − spread)/2 + rand()·spread              // centred on 0.5, width 0.8·gridChaos
  3. angleSpread ← (π/6) · gridChaos · (p.area < minSq·4 ? 0 : 1)   // small blocks stay rectangular
     b ← (rand() − 0.5) · angleSpread                     // cut-angle jitter, ±15° max
  4. halves ← Cutter.bisect(p, v, ratio, b, split ? ALLEY(0.6) : 0.0)
  5. for each half:
        if half.area < minSq · 2^(4·sizeChaos·(rand() − 0.5)):      // STOCHASTIC threshold
             if !rand_bool(emptyProb): emit half                     // leaf building
        else:
             recurse(half, ..., split = half.area > minSq / (rand()·rand()))
```

Five things that matter:

1. **Always bisect the longest edge**, perpendicular to it (rotated by `b`). This is what keeps footprints rectangular.
2. **`ratio` is centred on 0.5** with half-width `0.4·gridChaos`. At `gridChaos = 0.2` (Administration) the cut is at 0.42–0.58 — near-perfect halving, regular grid. At `gridChaos = 1.0` (Slum) it's 0.1–0.9 — wildly uneven blocks.
3. **Angle jitter is suppressed below `4·minSq`.** Source comment: *"Trying to keep buildings rectangular even in chaotic wards."* Big blocks get skewed cuts; the last two levels of recursion are always square-on. **This is the single most important trick for the MFCG look** — without it, small buildings come out as random quadrilaterals and the map reads as noise.
4. **The stop threshold is stochastic**: `minSq · 2^(4·sizeChaos·(U−0.5))`. At `sizeChaos = 0.8` the effective minimum spans `minSq·2^±1.6` ≈ **×0.33 … ×3.0**, so a single ward contains buildings across a 9× area range. At `sizeChaos = 0.3` (Administration/Military) it's `×0.66…×1.5` — uniform.
5. **`split` controls whether an alley gap is cut.** `split = half.area > minSq/(U·U)`. Since `E[1/(U·U)]` diverges, the RHS is usually enormous ⇒ **`split = false` for most deep recursions ⇒ gapless cuts ⇒ terraced rows of houses sharing party walls.** Only large blocks get a real 0.6-unit alley. This is exactly right for medieval terraces and is the second-most-important trick.

### 5.3 `Cutter.bisect` **[OS]**

```ts
function bisect(poly: Polygon, vertex: V, ratio = 0.5, angle = 0, gap = 0): Polygon[] {
  const next = polyNext(poly, vertex);
  const p1 = lerp(vertex, next, ratio);
  const d  = sub(next, vertex);
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  const vx = d.x * cosB - d.y * sinB;
  const vy = d.y * cosB + d.x * sinB;
  const p2 = { x: p1.x - vy, y: p1.y + vx };   // p1 + rot90(rot(d, angle))
  return cut(poly, p1, p2, gap);
}
```
The cut line passes through `p1` **perpendicular** to the edge direction rotated by `angle`. `p2` is only a direction hint — `cut` extends the line infinitely.

### 5.4 `Cutter.ring` **[OS]** — hollow blocks / cloisters

```ts
function ring(poly: Polygon, thickness: number): Polygon[] {
  const slices = [];
  forEdge(poly, (v1, v2) => {
    const v = sub(v2, v1);
    const n = norm(rot90(v), thickness);        // inward normal, length = thickness
    slices.push({ p1: add(v1, n), p2: add(v2, n), len: len(v) });
  });
  slices.sort((a, b) => a.len - b.len);          // "Short sides should be sliced first"
  const peel: Polygon[] = [];
  let p = poly;
  for (const s of slices) {
    const halves = cut(p, s.p1, s.p2);
    p = halves[0];                                // keep the inner remainder
    if (halves.length === 2) peel.push(halves[1]); // the peeled strip is a building
  }
  return peel;                                    // the CORE (final p) is DISCARDED
}
```
Sorting short-edges-first prevents a long edge's slice from eating the whole polygon before the short ones are peeled. Used by `Cathedral` 40% of the time (`thickness = 2 + 4r`).

**Upgrade:** keep the discarded core and label it a **courtyard/cloister**. Watabou throws away the exact polygon you need for the most characteristic medieval building type. One-line change, large visual payoff.

### 5.5 `Cutter.radial` / `semiRadial` **[OS]** — parks

```ts
radial(poly, center = centroid(poly), gap):
  for each edge (v0,v1): sector = [center, v0, v1]; if gap: sector = shrink(sector, [gap/2, 0, gap/2])
  // → a pie slice per edge

semiRadial(poly, center = vertex nearest centroid, gap):
  gap /= 2
  for each edge (v0,v1) where v0 !== center && v1 !== center:
      sector = [center, v0, v1]
      d = [ findEdge(poly, center, v0) === -1 ? gap : 0,  0,  findEdge(poly, v1, center) === -1 ? gap : 0 ]
      sector = shrink(sector, d)
```
`radial` fans from the interior centroid (compact blocks); `semiRadial` fans from an actual **vertex** of the block, skipping the two sectors that would be degenerate (elongated/concave blocks). Only Park uses these — they read as tree clumps/lawns, not buildings, and are rendered in `palette.medium` with no stroke.

### 5.6 `Ward.createOrthoBuilding` **[OS]** — castle / cathedral / farm

```
createOrthoBuilding(poly, minBlockSq, fill):
  if poly.area < minBlockSq: return [poly]
  c1 = poly.vector(findLongestEdge(poly))     // direction of the longest edge
  c2 = rot90(c1)
  loop until non-empty: return slice(poly, c1, c2)

slice(poly, c1, c2):
  v0 = findLongestEdge(poly); v1 = poly.next(v0); v = v1 − v0
  ratio = 0.4 + rand()·0.2                     // tighter than createAlleys
  p1 = lerp(v0, v1, ratio)
  c  = |dot(v, c1)| < |dot(v, c2)| ? c1 : c2   // pick the axis MORE PERPENDICULAR to this edge
  halves = poly.cut(p1, p1 + c)                // NO gap — buildings touch
  for each half:
    if half.area < minBlockSq · 2^(Random.normal()·2 − 1):
        if rand_bool(fill): emit half
    else: recurse
```
Two fixed global axes `c1 ⟂ c2` ⇒ **every cut is axis-aligned to the same frame** ⇒ a rectilinear, orthogonal complex. `Random.normal()` = mean of 3 uniforms (Irwin–Hall, mean 0.5), so the exponent is roughly `N(0, 0.33)` — much tighter than `createAlleys`. `fill < 1` (0.5–0.8) leaves gaps that read as courtyards and wings. This is how you get a castle that looks built rather than subdivided.

`findLongestEdge(poly) = poly.min(v => −|poly.vector(v)|)`.

### 5.7 `Ward.filterOutskirts` **[OS]** — the fade-out

Applied by `CommonWard` when `!model.isEnclosed(patch)`. Two independent fields multiply:

```
// (a) "populated edges" — edges that face something urban
for each edge (v1,v2) of patch.shape:
    if edge is on an artery:                    addEdge(v1, v2, 1.0)
    else if neighbour n exists && n.withinCity: addEdge(v1, v2, isEnclosed(n) ? 1.0 : 0.4)
addEdge(v1, v2, factor):
    store {origin v1, dir (v2−v1), d = factor · max over patch vertices of distance2line(...)}

// (b) per-vertex density
density[i] = gates.contains(v)                                   ? 1
           : patchByVertex(v).every(p => p.withinCity)           ? 2·rand()
           : 0

// keep a building iff:
minDist = min over populated edges, over building vertices of (distance2line(edge, v) / edge.d)  // clamped to 1
p       = Σ_j density[j] · interpolate(buildingCentre)[j]        // inverse-distance barycentric blend
keep    = Random.fuzzy(1) > minDist / p
```
`Polygon.interpolate(p)` = normalised inverse-distance weights over the ward's vertices (Shepard). `Random.fuzzy(1) = normal()` = mean of 3 uniforms. So a building near a road/urban edge, in a corner of the ward surrounded by city, almost always survives; one in the far corner of a fringe ward almost never does. **This is what makes MFCG's outskirts dissolve instead of ending abruptly.**

**[MFCG]** replaced this with a barycentric density field over a triangulation of the whole district: **1 inside walls, 9 outside**, road-facing 0.3, wall 0.5, canal 0.1. Devlog [0.10.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha): *"decreases the density of streets there, while keeping the density of buildings along those streets relatively high."*

---

## 6. Geometry utilities

All from `Polygon.hx` **[OS]**. Conventions: **CCW positive**, `rot90(p) = (−p.y, p.x)` = **inward** normal for a CCW ring.

### 6.1 `cut(p1, p2, gap)` — the primitive everything else is built from

```ts
function cut(poly: Polygon, p1: V, p2: V, gap = 0): Polygon[] {
  const x1 = p1.x, y1 = p1.y, dx1 = p2.x - x1, dy1 = p2.y - y1;
  let edge1 = 0, r1 = 0, edge2 = 0, r2 = 0, count = 0;
  for (let i = 0; i < poly.length; i++) {
    const v0 = poly[i], v1 = poly[(i + 1) % poly.length];
    const t = intersectLines(x1, y1, dx1, dy1, v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
    if (t && t.y >= 0 && t.y <= 1) {              // t.y = param along the polygon edge
      if (count === 0) { edge1 = i; r1 = t.x; } else if (count === 1) { edge2 = i; r2 = t.x; }
      count++;
    }
  }
  if (count !== 2) return [poly.slice()];          // degenerate — return unchanged
  const point1 = add(p1, scale(sub(p2, p1), r1));
  const point2 = add(p1, scale(sub(p2, p1), r2));
  let half1 = [point1, ...poly.slice(edge1 + 1, edge2 + 1), point2];
  let half2 = [point2, ...poly.slice(edge2 + 1), ...poly.slice(0, edge1 + 1), point1];
  if (gap > 0) { half1 = peel(half1, point2, gap / 2); half2 = peel(half2, point1, gap / 2); }
  const v = vectori(poly, edge1);
  return cross(dx1, dy1, v.x, v.y) > 0 ? [half1, half2] : [half2, half1];  // deterministic side order
}
```
`intersectLines` returns `(t1, t2)` params, `null` when parallel. The `count !== 2` guard is the only robustness net — with `count > 2` (a cut crossing a concave polygon 4×) it silently keeps the first two crossings and **produces garbage**. Add a proper convex/concave split, or clip against the half-plane properly.

The returned order is **stable by side of the cutting line**, which `shrink` and `ring` rely on.

### 6.2 `peel(v1, d)` — inset exactly one edge

`peel(v1, d) = cut(v1 + n, v2 + n, 0)[0]` where `v2 = next(v1)`, `n = norm(rot90(v2−v1), d)`. Used by `cut` to open the `gap`, and by `ring`.

### 6.3 `shrink(d: number[])` — convex inward offset

```ts
function shrink(poly, d) {
  let q = poly.slice(); let i = 0;
  forEdge(poly, (v1, v2) => {
    const dd = d[i++];
    if (dd > 0) {
      const n = norm(rot90(sub(v2, v1)), dd);
      q = cut(q, add(v1, n), add(v2, n), 0)[0];   // half-plane clip
    }
  });
  return q;
}
```
Successive half-plane clipping ⇒ **always produces a convex result**, never self-intersects, handles per-edge distances exactly. Cheap and exact for convex input. Wrong (over-clips) for concave input — hence the `isConvex()` test in `getCityBlock`. `shrinkEq(d)` = uniform.

### 6.4 `buffer(d: number[])` — general simple-polygon offset

The interesting one. Three phases:

```
PHASE 1 — build a probably-invalid offset ring
  for each edge (v0,v1) with distance dd:
      if dd == 0: push v0, v1
      else: n = norm(rot90(v1−v0), dd); push v0+n, v1+n
  // note: 2 vertices per edge, disconnected — corners are NOT joined
  // source comment: "here we may want to do something fancier for nicer joints"

PHASE 2 — resolve self-intersections by node insertion
  repeat until no cut:
    for i in [lastEdge .. n-3]:
      for j in [i+2 .. (i>0 ? n : n-1)]:
        t = intersectLines(edge_i, edge_j)
        if t && t.x,t.y ∈ (DELTA, 1−DELTA) with DELTA = 1e-6:
            pn = point on edge_i at t.x
            q.insert(j+1, pn); q.insert(i+1, pn)   // SAME Point object inserted TWICE
            restart
PHASE 3 — extract the largest simple component
  walk the ring; at each step, next = (i+1) % n;
  jump to the OTHER index holding the same Point object (indexOf, else lastIndexOf)
  → each closed walk is one component; keep the one with the largest signed area
```
Phase 3 is the elegant part: inserting the **same object reference** at two positions turns the self-intersecting ring into a graph whose components you can trace by identity. In TypeScript, insert a shared `{x,y,id}` node or an index into a node array — do **not** insert two structurally-equal-but-distinct objects.

**Complexity is O(n³) worst case** (restart-on-every-cut). For blocks of ≤30 vertices that's fine. If you need better, use [Clipper2](https://github.com/AngusJohnson/Clipper2) / `polygon-clipping` for a proper Minkowski offset with miter/round joins — but note Watabou's version supports **per-edge distances**, which standard offset libraries don't. Keeping it is the pragmatic choice.

**Doc comment from the source, worth heeding:** *"It's kind of reliable for both convex and concave vertices, but only if all distances are equal. Otherwise weird 'steps' are created."*

### 6.5 `inset(p1, d)` / `insetAll` — fixed-vertex-count inset

Moves the two endpoints of one edge along the adjacent edges by `t = d / sin(angle)`, clamped to `min(t, |v0|·0.99)` at convex vertices and `min(t, |v1|·0.5)` at concave ones, signed by the cross product. Preserves vertex count; the source calls it *"not very reliable."* Unused in the main path — skip it.

### 6.6 Keeping footprints from self-intersecting

The reason MFCG footprints never self-intersect is structural, not numerical:

1. **Every building is produced only by `cut`** — a convex operation on the piece it's applied to. Cuts of a convex polygon are convex.
2. Blocks are made convex up front by `shrink`, or repaired by `buffer`'s largest-component extraction.
3. `bisect` always cuts perpendicular to the *longest* edge, so the two halves have bounded aspect ratio and `cut` reliably finds exactly 2 crossings.

Add two guards **[from ProbableTrain, verified]**: reject slivers by **shape index** `area / perimeter² < 0.04` (rejects anything thinner than ~1:4), and reject leaves with `< 4` vertices. **[MFCG]** does the same plus `OBB sides ≥ 1.2` and `area / OBBarea > 0.5`.

### 6.7 Other primitives worth having

`square` (shoelace ×0.5, signed) · `perimeter` · `compactness = 4π·area/perimeter²` · `center` (vertex mean) vs `centroid` (area-weighted) · `isConvexVertex(v) = cross(v1−v0, v2−v1) > 0` · `simplyfy(n)` (greedily drop the vertex with smallest triangle area — Visvalingam) · `filterShort(threshold)` · `split(p1,p2)` (slice the ring at two existing vertices) · `interpolate(p)` (Shepard weights) · `rect(w,h)` · `regular(n,r)` · `circle(r) = regular(16, r)`.

---

## 7. City context: water, coast, farms

**None of this exists in the OS build.** `Model.waterbody` is declared and never assigned; `Topology`'s comment mentions "shore" but nothing sets it. Everything below is **[MFCG]**, recovered from `mfcg.js` and the devlogs. The pipeline gained two stages: `buildDomains` (land/water topology) and `buildCanals` (rivers):

```
buildPatches → optimizeJunctions → buildDomains → buildWalls →
buildStreets → buildCanals → createWards → buildCityTowers → buildGeometry
```

### 7.1 The mechanism that makes all of it work: **edge tagging**

`model.Edge` carries a kind: `HORIZON | COAST | ROAD | WALL | CANAL`. **Water never cuts geometry.** The river runs *along Voronoi cell boundaries*; every half-edge on its course is tagged `CANAL`, and each ward's `getAvailable()` insets by a per-edge-kind amount:

```
coast:  1.2   (2.0 if the cell is a landing)
road:   1.0
wall:   THICKNESS/2 + 1.2  = 0.95 + 1.2
canal:  canalWidth/2 + 1.2  (+1.2 extra at the source vertex)
plaza-facing: 1.0
default: 0.6
```
One inset table drives rivers, coasts, walls, roads and plazas identically. **This is the single most transferable idea in the whole system** — it's §5.1 generalised, and it composes cleanly where boolean geometry would not.

### 7.2 Rivers — `Canal`

Exactly **one** canal is built (`canals = riverNeeded ? [Canal.createRiver(this)] : []`), despite the array. Routing graph covers non-water cells only, excluding the wall polygon, citadel wall vertices, all gates and all existing arteries — so a river can never run along a street or through a wall except transversally.

- **`regularRiver`** (inland): pick a horizon vertex `k`; find the horizon vertex `n` most opposite (min dot of normalised positions); A* `n → (vertex adjacent to center)`, then A* `→ k`; splice at the first common vertex.
- **`deltaRiver`** (coastal): mouths = shore vertices with >1 non-water neighbour cell, sorted by distance from origin; upstream target = max dot with the shore normal.

`validateCourse` rejects: length `< earthEdge.length/5`; touching the shore at an interior vertex; non-transversal crossing of wall or artery. Then `smoothOpen` (Chaikin), snap to shore at the mouth, and pull to the exact wall intersection where it crosses.

```
width = (3 + inner.length/5) · (0.8 + 0.4·rnd) · (rural ? 1.5 : 1)
```
`rural` = no interior course vertex borders an inner cell. A 25-patch city → base 8 units = **32 m**, ±20%, ×1.5 if it merely skirts the city.

**Watergates:** where the course crosses a wall vertex → `wall.addWatergate(v, canal)`, and that vertex is removed from the tower list.

**Bridges:** every artery vertex genuinely crossing the course becomes a bridge. Extra bridges are added on candidate vertices (course vertices bordering an inner cell, minus watergates) with continuation probability `1 − 2·nBridges/nCandidates`, weighted `1/vertex.edges.length`. Exported as 2-point segments of length `canalWidth + 1.2` perpendicular to the course, in the `planks` layer.

**Islands are not supported.** `buildDomains` keeps only the *largest* connected land component and the *largest* water component; stray islands are discarded, and it throws if the water body doesn't touch the horizon.

### 7.3 Coast — a noise-perturbed rotated disc

```
noise = fractalPerlin(6 octaves)
f = 20 + 40·rnd
k = 0.3·maxR·(avg3(rnd)·2 − 1)
n = maxR·(0.2 + |...|)                      // sea radius
coastDir = urlParam.sea ?? floor(rnd·20)/10  // 0..1.9  (0=E, 0.5=N, 1=W, 1.5=S)
h = coastDir·π ; rotate every cell centroid by (cos h, sin h) → p'
g = (n + f, k)
u = dist(g, p') − n ;  if (p'.x > g.x) u = min(u, |p'.y − k| − n)   // half-plane cap
r = noise((p'.x + maxR)/(2·maxR), (p'.y + maxR)/(2·maxR)) · n · sqrt(|p'| / maxR)
if (u + r < 0) cell.waterbody = true
```
The `sqrt(|p'|/maxR)` term scales noise amplitude with distance from centre — **smooth coast near the city, jagged far out**. `waterEdge` then gets 1–3 Chaikin passes.

### 7.4 Harbour, landings, piers

```js
maxDocks = floor(sqrt(size / 2)) + (riverNeeded ? 2 : 0)
```
Inner cells bordering the shore become `landing = true` until the budget is spent; a cell wedged between two landings is promoted too. If a gate street can't reach the horizon, that gate's shore cells are force-promoted.

**The harbour ward is the *water* cell adjacent to a landing**, not a land cell. That's the non-obvious modelling choice, and it makes piers trivial — the pier normal comes free from the shared land/water edge:

```
edge   = longest edge shared with a landing cell (trimmed to midpoint if it touches a river mouth)
nPiers = floor(len / 6)
each pier = 2-point segment of length 8 units (32 m) normal to the shore
spacing margin = (1 − 6·(n−1)/len) / 2
```
Wall sections bordering water are deleted (`segments[i] = false`).

### 7.5 Farmland — a two-harmonic lobed envelope

```
a = 2·avg3(rnd); b = avg3(rnd); c, d = rnd·2π
θ = bearing of cell from centre
g = a·sin(θ + c) + b·sin(2θ + d)
dist(cell, centre) < (g + 1)·maxCityRadius  →  Farm    else  Wilderness
```
Not a radius — a lobed blob, so farmland reaches further along some bearings. Constants `MIN_SUBPLOT = 400`, `MIN_FURROW = 1.3`. Fields are exported as `subPlots` polygons plus `furrows` line segments. The OS build's version is much cruder (`Random.bool(0.2) && compactness ≥ 0.7`).

### 7.6 Suburbs — three mechanisms

1. **Gate suburbs** (also in OS): per wall gate, probability `1 − 1/(nPatches−5)`, promote surrounding cells to `withinCity` + urban ward.
2. **Shanty towns** (`?shantytown=1`): add `nPatches·(1+rnd³)·0.5` outside cells, weighted `k²/d²` where `k` = urban-neighbour count and `d = min(3·dist(centre), 2·dist(road vertex), dist(shore vertex), dist(canal vertex))` — so they hug roads, river and coast. Devlog [0.6.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/67134/060-custom-colors-scale-bar-elevation).
3. **Density falloff** (§5.7).

Real-world calibration: Bristol c.1300 had 55 ha intramural, 130 ha total ⇒ **suburbs are 58% of built-up area** ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678)).

### 7.7 Terrain outside town

**[OS]**: nothing. Non-city patches get `new Ward()` with empty geometry and aren't even added to the display list (`default: patchDrawn = false`).
**[MFCG]** 0.11.4 adds `Forester`: `PoissonPattern(30, 30, 2.25)` + 5-octave Perlin (base grid 0.05, persistence 0.5), keep a point if `(noise+1)/2 < density`; forests fill all space not occupied by city, farmland or water, and roads are drawn *under* the forest.

---

## 8. Rendering style

### 8.1 Palettes **[OS]** — `Palette.hx`, verbatim

Four slots only: `paper, light, medium, dark`.

| Preset | paper | light | medium | dark |
|---|---|---|---|---|
| **DEFAULT** | `#CCC5B8` | `#99948A` | `#67635C` | `#1A1917` |
| BLUEPRINT | `#455B8D` | `#7383AA` | `#A1ABC6` | `#FCFBFF` |
| BW | `#FFFFFF` | `#CCCCCC` | `#888888` | `#000000` |
| INK | `#CCCAC2` | `#9A979B` | `#6C6974` | `#130F26` |
| NIGHT | `#000000` | `#402306` | `#674B14` | `#99913D` |
| ANCIENT | `#CCC5A3` | `#A69974` | `#806F4D` | `#342414` |
| COLOUR | `#FFF2C8` | `#D6A36E` | `#869A81` | `#4C5950` |
| SIMPLE | `#FFFFFF` | `#000000` | `#000000` | `#000000` |

Role mapping: **`paper`** = background (`stage.color`) and the fill of road ribbons. **`light`** = building fill. **`medium`** = park groves and road casing. **`dark`** = all outlines, walls, towers, gates.

### 8.2 Strokes **[OS]** — `Brush.hx`

```
THIN_STROKE = 0.150;   NORMAL_STROKE = 0.300;   THICK_STROKE = 1.800;
```
Joints are `MITER` by default. (At 4 m/unit: normal stroke = 1.2 m, wall = 7.2 m.)

### 8.3 Draw order and per-element recipe **[OS]** — `CityMap.hx`

```
1. roads          (bottom)
2. patch geometry (per ward type)
3. invisible hot areas for tooltips
4. city wall, then citadel wall  (top)
```

**Roads — two overlaid strokes, no fill:**
```
lineStyle(MAIN_STREET + NORMAL_STROKE = 2.3, palette.medium, caps = NONE); drawPolyline(road)
lineStyle(MAIN_STREET − NORMAL_STROKE = 1.7, palette.paper);                drawPolyline(road)
```

**Buildings — outline pass then fill pass (`drawBuilding`):**
```
setStroke(line = palette.dark, width = thickness · 2); for each block: drawPolygon
noStroke(); setFill(palette.light);                    for each block: drawPolygon
```
Drawing the stroke at **double width first and then filling on top** leaves exactly `thickness` of visible outline and — crucially — makes adjacent buildings' outlines merge into one continuous line rather than doubling. That's the ink-on-paper look. `thickness`: Castle `NORMAL_STROKE·2 = 0.6`, Cathedral `0.3`.

**Common wards** skip the two-pass and just `setColor(g, light, dark)` (stroke `0.3`) then `drawPolygon` each building.

**Parks**: `setColor(g, medium)` — fill only, **no stroke**, so groves read as soft blobs.

**Wall**: `lineStyle(THICK_STROKE = 1.8, dark); drawPolygon(wall.shape)`.
**Tower**: filled circle, `r = 1.8` (`× 1.5 = 2.7` for the citadel), no stroke, `dark`.
**Gate**: a stroke of width `THICK_STROKE·2 = 3.6` in `dark`, drawn **across** the wall:
```
dir = normalize(wall.next(gate) − wall.prev(gate)) · (THICK_STROKE · 1.5 = 2.7)
line from gate − dir to gate + dir            // total length 5.4 units ≈ 22 m
```

**Camera** (`TownScene.layout`): centre the map, `scale = (scMax/scMin > 2 ? scMax/2 : scMin) · 0.5` where `scMin/scMax` are `min/max(rWidth/cityRadius, rHeight/cityRadius)`.

**Labels [OS]:** there is no label layer — `getLabel()` feeds a hover **tooltip** only ("Craftsmen", "Slum", "Temple", "Castle", "Market", "Park", "Farm", "Gate", …). No legend, no scale bar. **[MFCG]** added map labels in 0.5.5 (Archivo Narrow), a scale bar in 0.6.0, and curved labels along straight-skeleton "ridges" in 0.11.1.

### 8.4 Modern palettes **[MFCG]** — 10 slots

Keys: `colorPaper, colorDark(Ink), colorRoof, colorWater, colorGreen, colorRoad, colorWall, colorTree, colorLabel, colorLight(Elements)`, plus `tintMethod`, `tintStrength` (0–100, default 50), `weathering` (0–100, default 20). Fallbacks: `roof→light`, `water/green/road→paper`, `wall/tree/label→dark`. Downloadable at [watabou.github.io/city_styles.html](https://watabou.github.io/city_styles.html) (`styles/city_<name>.json`).

| | Paper | Ink | Roof | Water | Green | Road | Wall | Tree | Label | Light | tint | str |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **default** | `#CCC5B8` | `#1A1917` | `#A5A095` | `#7F7A71` | `#A59F93` | `#CCC5B8` | `#1A1917` | `#7F7A71` | `#1A1917` | `#CCC5B8` | Brightness | 30 |
| **ink** | `#CCCAC2` | `#130F26` | `#9A979B` | `#6C6974` | `#A5A2A2` | `#CCCAC2` | `#130F26` | `#47454C` | `#150C3F` | `#BFBFBF` | Brightness | 40 |
| **bw** | `#FFFFFF` | `#000000` | `#DDDDDD` | `#FFFFFF` | `#EEEEEE` | `#FFFFFF` | `#000000` | `#EEEEEE` | `#000000` | `#FFFFFF` | Brightness | 0 |
| **vivid** | `#FFF2C8` | `#4C5950` | `#D6A36E` | `#779988` | `#C3CC99` | `#FFF2C8` | `#606661` | `#667755` | `#2D3D4C` | `#F2F2DA` | Spectrum | 20 |
| **natural** | `#BFBFB5` | `#3F322C` | `#66707F` | `#8F9997` | `#8D927B` | `#E1DBD5` | `#4C4C4C` | `#777F66` | `#662C28` | `#D8D8CD` | Spectrum | 20 |
| **modern** | `#E5E5DA` | `#333333` | `#E5B75B` | `#59A3B2` | `#CCCCA3` | `#CCCCC1` | `#666660` | `#777F66` | `#222222` | `#D8D8C3` | Overlay | 25 |
| **fairytale** | `#A5A552` | `#261C16` | `#7F543F` | `#66727F` | `#D8A641` | `#CCB7A3` | `#FFD8B2` | `#516655` | `#FFFFE5` | `#EEEEEE` | Overlay | 20 |
| **tapestry** | `#CCB28E` | `#1E2232` | `#8C4D5C` | `#95A59D` | `#A59D74` | `#B2946B` | `#66625B` | `#727F66` | `#1E2232` | `#E5CEA0` | Spectrum | 25 |
| **academia** | `#D7BA9C` | `#28263B` | `#7D83A5` | `#606277` | `#B28E7C` | `#CDC3A8` | `#FFEFBF` | `#8C7055` | `#1C1933` | `#FAF7A8` | Overlay | 20 |
| **turquoise** | `#D1B488` | `#281B12` | `#CB5644` | `#91B8A3` | `#998F4A` | `#E6DAC2` | `#F9F9DD` | `#344E4D` | `#212C48` | `#F9EDBD` | Overlay | 20 |
| **june** | `#BFC192` | `#262316` | `#8C8069` | `#ADC6CB` | `#929971` | `#DED9BC` | `#646152` | `#647650` | `#262316` | `#CCC2A1` | Spectrum | 8 |

Note `default.paper` is **identical** to the OS `DEFAULT.paper` — the lineage is unbroken.

**Tint functions** (per-district / per-roof variation, `b` = index, `c` = count):
```
spectrum(a,b,c):   hsv(h − 360·(c−1)/c · str/100 · (b/(c−1) − 0.5), s, v)
brightness(a,b,c): hsv(h, s, v + min(v, 1−v) · str/50 · (b/(c−1) − 0.5))
overlay(a,b,c):    lerp(rgb, hsv(h + 360·b/c, s, v), str/100)
```

**Corrections to widespread assumptions:**
- **There is no paper texture.** `colorPaper` is a flat fill. The "ink on paper" feel comes entirely from the 4-value palette + the double-stroke building outline + hairline strokes.
- **Hatching was removed** in 0.9.2 (it shipped in 0.4.1). Zero `hatch` hits in the current bundle. Field rendering is now `Furrows` (line segments in `colorGreen`, default), `Plain` (solid `colorGreen` subplots), or `Hidden` — pref key is `farm_fileds`, misspelling shipped.
- **Blueprint** removed 0.9.1; **Night** removed 0.9.2; **Ancient** never existed in MFCG (only in the OS build).
- Modern stroke widths: `strokeThin 0.8 / strokeNormal 1.6 / strokeThick 3.2`, ÷3 when "Thin lines" is on.
- Roof ridges (0.11.0) are drawn from a **straight skeleton**: footprint vertices jittered by `polar(0.1·(avg3(rnd)·2−1), π·rnd)`, bones with `slope.length > 1.2` drawn as ridge lines.

### 8.5 Export

**[MFCG]** JSON is "GeoJSON-like but not GeoJSON". Transform: `[round(1000·x·4)/1000, round(1000·(−y)·4)/1000]` — **Y negated, ×4, 3 decimals**. Feature order: `values, earth, roads, walls, rivers, planks, buildings, prisms, squares, greens, fields, trees, districts[, water]`. `values` has `roadWidth: 8, towerRadius: 7.6, wallThickness: 7.6, generator: "mfcg", version, riverWidth` and **`geometry: null`**. `planks` = piers **and** bridges. `water` key is absent entirely when there's no water. Only district **names** carry semantics — types, ward classes and seeds are not exported. Discussion: [itch.io/t/2733960](https://itch.io/t/2733960/geojson), [itch.io/t/773197](https://itch.io/t/773197/geojson-format).

**Interop win:** accept MFCG's URL params — `name, population, size, seed, river, coast, farms, citadel, urban_castle, hub, plaza, temple, walls, shantytown, gates, sea, style, export, preview` — and you drop straight into [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) ecosystem, whose users are the largest downstream consumer of MFCG. FMG's population→size law (`modules/ui/editors.js`):
```ts
size = minmax(Math.ceil(2.13 * ((pop * populationRate) / urbanDensity) ** 0.385), 6, 100);
```

---

## 9. How to beat MFCG

Ranked by (visual payoff) / (implementation cost).

### 9.1 Free wins — fix the bugs (hours)

| | Fix |
|---|---|
| `Polygon.distance` returns distance to vertex[0] | `d = d1` — makes every radial ward heuristic actually work |
| `aStar` is FIFO Dijkstra | binary-heap A* with Euclidean `h` ([redblobgames](https://www.redblobgames.com/pathfinding/a-star/introduction.html)) |
| Lloyd relaxation is a no-op (frame offset) | drop it; hard-code the plaza rectangle like **[MFCG]** |
| `CurtainWall.real` is unconditionally `true` | honour the parameter |
| Deck exhaustion ⇒ all-Slum above 36 patches | weighted multinomial with per-type caps |
| Any failure ⇒ regenerate the whole city | local repair: re-pick the citadel patch, re-route one street |
| `Cutter.ring` discards the core | **keep it as a courtyard** — one line, biggest look-per-character in the codebase |
| `tidyUpRoads` never re-merges arteries | weld to fixpoint ⇒ visibly longer, more coherent streets |

### 9.2 Burgage plots — the single biggest realism win

MFCG's lots have **no consistent relationship to the street**: `createAlleys` bisects a blob recursively, so frontage is accidental. Real medieval plots are **strips perpendicular to a frontage line, of near-constant width**, in *series*.

Use **Vanegas et al., "Procedural Generation of Parcels in Urban Modeling" (EG 2012)**, [PDF](https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf), Algorithm 1 — it is literally a burgage-plot generator:

```
subdivSkeleton(block):
  SS  ← straightSkeletonOffset(contour(block), d_offset)   // d_offset = PLOT DEPTH
  LS  ← [convertToStrip(f) for f in SS.faces]               // α-strips
  LS2 ← mergeOnLogicalStreets(LS)                           // one strip per street frontage
  LS3 ← fixDiagonalEdges(LS2)                               // → β-strips
  for s in LS3: slice(s)     // rays PERPENDICULAR to the supporting edge,
                             // spacing ~ N((Wmin+Wmax)/2, σ² = 3ω)
  processSmallLargeOrTriangularLots(LS, Amin, Amax)          // union slivers with neighbours
```
Parameters: `Wmin,Wmax` = street frontage; `d_offset` = plot depth; `ω ∈ [0,1]` = split irregularity; `ξ` = street-access preference (`ξ=1` always guarantees access, `ξ=0` allows landlocked plots). **The leftover interior region with no street access is your backland / back lane / courtyard** — and the paper explicitly says it "can be further partitioned using an arbitrary subdivision style."

Real dimensions to plug in ([burgageplots.info](https://www.burgageplots.info/a-planned-approach), [Urban History: Scottish burgage plots](https://www.cambridge.org/core/journals/urban-history/article/framework-and-form-burgage-plots-street-lines-and-domestic-architecture-in-early-urban-scotland/4FC18665945BC7A9144C4C9165838A5A), [VCH Wilts vi](https://www.british-history.ac.uk/vch/wilts/vol6/pp69-72)):

```
UNIT      1 perch/rod/pole = 16.5 ft = 5.0292 m — quantise every plot dimension to this
FRONTAGE  modal 8.53–9.75 m (28–32 ft); full range 5–40 m
          Scottish metrology over 49 blocks: modal 5.76–12.80 m, clustering 8–9 m,
          plots in QUARTER-UNIT increments spanning 0.75–2.5 units, ~⅔ within ±0.5 m
DEPTH     ladder {35, 60, 90, 100, 201} m
W:D       1:2–1:3.5 planned cores (Salisbury 3×7 perches, Stratford 3½×12, bastide ayral 8×24 m)
          1:5–1:6   common English default (Charmouth 4×20 perches)
          1:10–1:11 long tails to a back lane (Hungerford 2×20 rods, Tewkesbury 4×40)
BACK LANE 4.9–7.3 m (bastide venelle 1–3 m)
```
*Why 8–10 m:* it's the max practical span of a single oak beam. A medieval room spans ~15 ft, so a 28-ft plot = two rooms, or one room plus a side passage. **Emit plots as a series sharing one frontage line and depth — never independently.** That's Conzen's "plot series," and it's what makes real towns look designed rather than diced.

### 9.3 Streets that aren't cell edges

**[OS]** streets *are* Voronoi edges, so no street can cross a ward, there are no through-routes, and hierarchy is three hard-coded widths. Two replacements:

**Tensor fields** — Chen et al., *Interactive Procedural Street Modeling* (SIGGRAPH 2008), [PDF](https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf). Encode `T = R·[cos2θ, sin2θ; sin2θ, −cos2θ]`; place *radial* elements at gates and the market, *grid* elements in planned quarters, a *boundary* element along the river, a *height-field* element on slopes; blend `T(p) = Σ e^(−d‖p−pᵢ‖²)·Tᵢ(p)`; add a Perlin **rotation field** `R₁ ∈ [−π/2, π/2]` that rotates major and minor eigenvectors in *opposite* directions — that's what breaks perpendicularity and gives organic form. Trace streamlines with adaptive RK.

Tuned constants from [ProbableTrain/MapGenerator](https://github.com/probabletrain/mapgenerator) (`src/ts/ui/main_gui.ts`) — note the clean **1 : 5 : 20** `dsep` ladder:
```
minor: dsep 20,  dtest 15, dstep 1, dlookahead 40, dcirclejoin 5, joinangle 0.1,
       pathIterations 1000, seedTries 300, simplifyTolerance 0.5
major: dsep 100, dtest 30, dlookahead 200
main:  dsep 400, dtest 200, dlookahead 500
buildings: maxLength 20, minArea 50, shrinkSpacing 4, chanceNoDivide 0.05
```
Apache-2.0 Go port with RK4 + flatbush: [Flokey82/go_gens](https://github.com/Flokey82/go_gens) `gencitymap/`.

**Or L-systems** — Parish & Müller, *Procedural Modeling of Cities* (SIGGRAPH 2001), [PDF](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf). The contribution is the **ideal successor**: the L-system emits a template with unassigned parameters, `globalGoals()` fills them from population steering (`direction = argmax_ray Σ density(p)/dist(p, roadEnd)`), `localConstraints()` repairs by **prune → rotate → snap**. Pattern rules: Basic / New York / Paris-radial / San Francisco, blended by a greyscale weight map. Working constants from [phiresky/procedural-cities](https://github.com/phiresky/procedural-cities) and [t-mw/citygen-godot](https://github.com/t-mw/citygen-godot) (MIT):
```
DEFAULT_SEGMENT_LENGTH 300 / HIGHWAY 400;  branch angle ±3°, straight ±15°
BRANCH_PROBABILITY 0.4 normal / 0.02–0.05 highway
MINIMUM_INTERSECTION_DEVIATION 30°;  ROAD_SNAP_DISTANCE 50;  SEGMENT_COUNT_LIMIT 2000–7000
```

Cheaper middle path for the hinterland: Amit Patel's `Roads.as` in [mapgen2](https://github.com/amitp/mapgen2) draws roads on the **boundaries between elevation bands** of the Voronoi dual — always connected, always terrain-following. Substitute *density* bands for elevation bands and you get a free main-street network.

### 9.4 Building shape variety — L, U, courtyard, cruciform

**[OS]** every footprint is a convex product of straight cuts. No L-shapes, no courtyards, no cruciform churches. The fix is four rules from CGA Shape (Müller et al., SIGGRAPH 2006, [PDF](https://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf)):

```
1: lot ; S(1r, height, 1r) Subdiv("Z", Scope.sz·rand(0.3,0.5), 1r){ facades | sidewings }
2: sidewings ; Subdiv("X", Scope.sx·rand(0.2,0.6), 1r){ sidewing | ε }
               Subdiv("X", 1r, Scope.sx·rand(0.2,0.6)){ ε | sidewing }
3: sidewing ; S(1r, 1r, Scope.sz·rand(0.4,1.0)) facades      : 0.5
            ; S(1r, Scope.sy·rand(0.2,0.9), Scope.sz·rand(0.4,1.0)) facades : 0.3
            ; ε : 0.2
4: facades ; Comp("sidefaces"){ facade }
```
Rule 2 emits a wing on each side **independently** ⇒ **I (none) / L (one) / U (two)**, and the gap between wings **is** the courtyard. Rule 3's `0.5/0.3/0.2` sets wing depth/height variety. Four rules, whole vocabulary.

**Cruciform churches**: footprint = `nave ∪ transept ∪ chancel [∪ apse ∪ crossing tower]` as a union of oriented rectangles. Orient east-facing; align the nave to the local street grain **only if within ~45° of east**, otherwise force east — the misalignment against the surrounding grain is itself a strong realism cue. Then roof by **straight skeleton**, which produces the cross-gable automatically at the reflex corners of the crossing. Use [twak/campskeleton](https://github.com/twak/campskeleton) (Apache-2.0, weighted, supports negative weights for offsetting either direction) rather than CGAL (GPL/commercial). Reference: Kelly & Wonka, *Interactive Architectural Modeling with Procedural Extrusions* (TOG 2011), [PDF](https://peterwonka.net/Publications/pdfs/2011.TOG.Kelly.ProceduralExtrusions.TechreportVersion.final.pdf) — per-edge direction-plane angle `θ ∈ [−π/2, π/2]`, courtyards as explicit clockwise holes, robustness epsilons `δ₁=1e-4, δ₂=1e-6, δ₃=1e-5`.

Density check: York had ~45 parish churches c.1300 against 10–15k people ⇒ **1 church per 250–350 inhabitants** ([Medieval parish churches of York](https://en.wikipedia.org/wiki/Medieval_parish_churches_of_York)). A cathedral is not a building but a **walled precinct with its own gates** — Salisbury's Close is >32 ha ([Salisbury Cathedral](https://www.salisburycathedral.org.uk/visit-what-see/largest-cathedral-close)). Reserve the precinct first, then place the church inside; the precinct interrupts the plot series, which is exactly what real cathedral cities look like.

### 9.5 Growth history — the thing no generator does

Every MFCG city is one age. Real ones are stratified:

```
epoch 0: nucleus (castle / ford / abbey / crossroads) + market
epoch 1..n: expand outward; freeze a wall circuit at each epoch
every superseded wall line becomes a FIXATION LINE → INNER FRINGE BELT
  (cemeteries, friaries, gardens, hospitals, prisons — large parcels, low building coverage)
per plot series, run the BURGAGE CYCLE (≈180 yr, Alnwick):
  phase 1 fill the backland toward climax coverage
  phase 2 clearing;  phase 3 urban fallow
  then amalgamate 2–4 plots and redevelop at coarser grain
  truncate tails into tail-end plots fronting the back lane
```
This is M.R.G. Conzen's *Alnwick, Northumberland: A Study in Town-Plan Analysis* (1960) — the monograph isn't online, but the apparatus is summarised in [EPUM Briefing Paper 1](https://www.surf.com.cy/wp-content/uploads/2023/03/EPUM_BP1_Historical-Geographical.pdf) and the [Łódź fringe-belt paper](https://czasopisma.uni.lodz.pl/fgsoe/article/download/1205/874/0).

Add an **encroachment pass**: narrow streets by **1.6–2.9 m (mean 2.2)** in older quarters, and infill 20–40% of the market square with a building island. Measured from 13 Edinburgh/Canongate sites; Salisbury's surviving Oatmeal Row / Butcher Row / Fish Row are fossilised stall lines ([VCH](https://www.british-history.ac.uk/vch/wilts/vol6/pp85-87)).

### 9.6 Make the Voronoi invisible

Two cheap, high-impact tricks:

1. **[MFCG] 0.10.0**: merge adjacent cells into district-wide groups **before** subdividing, and run the bisection over the merged polygon. Watabou's own verdict: *"This change makes cells almost invisible and often there is an illusion of streets following some kind of underlying landscape. There is no underlying landscape of course."* ([devlog](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha))
2. **Amit Patel's `NoisyEdges`** ([mapgen2](https://github.com/amitp/mapgen2)) — recursive quadrilateral midpoint displacement constrained inside the Voronoi/Delaunay quad, so edges are jagged but non-self-intersecting **and shared by both adjacent cells (no cracks)**. The art is the per-edge-type recursion floor: `minLength = 10` default, `3` at a type boundary, `1` for coast and river, `100` for open water.

### 9.7 Acceptance metrics — how to *prove* you beat it

Compute on your generated street graph and compare to real cities ([Boeing](https://escholarship.org/content/qt5db3f718/qt5db3f718.pdf), [Barthelemy 2024](https://arxiv.org/pdf/2409.08016), [PMC8585513](https://pmc.ncbi.nlm.nih.gov/articles/PMC8585513/)):

| Metric | Organic (W/S Europe) | Planned/grid |
|---|---|---|
| avg node degree | 2.5–2.8 | 3.0–3.5 |
| dead-end fraction | ~14% (to 39%) | low |
| degree-4 fraction | ~18% | ~2× |
| median segment length | **63–78 m** | ~100 m |
| circuity | ~6.4–6.5% | ~5% |
| orientation-order | **0.02–0.05** | 0.1–0.32 |
| intersections / km² | 73–116 | ~53 |
| **Gini of eigenvector centrality** | **0.71** | **0.47** |
| block area distribution | power law | — |

The Gini figure is the sharpest organic/planned discriminator (72 pre-industrial Afro-Eurasian sites, p<0.01). **MFCG will fail it** — Voronoi cell edges give near-uniform centrality, whereas real organic networks concentrate connectivity in a small spine. That's your provable improvement.

Size/population calibration ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678), 173 European cities c.1280–1320): `ln(area) = α + β·ln(pop)` with **β = 0.714** (95% CI 0.662–0.766) — bigger medieval cities are *denser*. Density gradient **200 inh/ha centre → 75 inh/ha periphery**. Typical enclosed area 20–81 ha; Winchelsea 1292 gives **13 plots/ha gross**. **[MFCG]** itself just does `population ≈ 6 × buildings`, rounded to 2 significant digits, and it's display-only.

### 9.8 Licensing

| Project | License | Copy? |
|---|---|---|
| watabou/TownGeneratorOS | GPL-3.0 | **No** — reimplement (algorithms/constants aren't copyrightable) |
| MFCG / Village Generator | closed | No |
| Azgaar/Fantasy-Map-Generator | MIT | Yes |
| Flokey82/go_gens | Apache-2.0 | Yes |
| twak/campskeleton | Apache-2.0 | Yes |
| t-mw/citygen-godot | MIT | Yes |
| amitp/mapgen2 | MIT | Yes |
| nothings/stb (herringbone Wang tiles) | public domain / MIT | Yes |
| ProbableTrain/MapGenerator | GPL-3.0 / LGPL-3.0 | LGPL parts linkable |
| phiresky/procedural-cities | AGPL | avoid for SaaS |
| CGAL `Straight_skeleton_2` | GPL / commercial | use campskeleton instead |

---

## Suggested build order

1. Indexed mesh + Delaunator Voronoi + the spiral (§0, §1.1–1.3) — you'll see recognisable patches on day one.
2. `cut` / `shrink` / `buffer` / `peel` (§6) — everything downstream is these four.
3. `findCircumference` → wall → gates → towers (§2).
4. Topology + real A* → streets/roads → weld → smooth (§3).
5. `getCityBlock` + `createAlleys` with the **angle-suppression** and **gapless-split** rules (§5.1–5.2) — this is the moment it starts looking like MFCG.
6. Wards + `rateLocation` (§4), then `filterOutskirts` (§5.7).
7. Renderer: 4-colour palette, double-stroke buildings, two-pass roads (§8).
8. Then upgrade: edge-tagged water/coast (§7.1), districts (§4.5), burgage plots (§9.2), CGA wings (§9.4).

Local checkout of the ground-truth source is at `/home/claude/TownGeneratorOS` if you want to diff against it while porting.

agentId: a8e1a0328f4d2abda (use SendMessage with to: 'a8e1a0328f4d2abda', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 188789
tool_uses: 23
duration_ms: 3273728</usage>

---

<!-- fuente: city-mfcg-closed.md -->

Research complete. Here is the full report.

---

# MFCG (closed-source, 0.8.0 → 0.11.5) — Research Report

## 0. Method note — itch.io truncation

**Every one of the 17 itch.io devlogs is truncated**, with the body cut off at a `(more)` or `…link` pointing to Patreon. The itch pages carry only 1–3 sentences plus the comments section. I recovered the **complete Patreon post bodies via the Wayback Machine** (direct Patreon fetch returns Cloudflare 403). Patreon post IDs are given per section. I also mined the live app bundle `https://watabou.github.io/city-generator/mfcg.js` (version string `0.11.5`), the styles page, and `grammar.json` for concrete parameter names, formulas and hex values — those are clearly marked as **[app bundle]**.

`https://watabou.github.io/news.html` gives longer previews than itch but is still 1-sentence teasers linking to Patreon. `https://watabou.github.io/faq.html` has no MFCG specifics beyond: *"All generators of Procgen Arcana are written in **Haxe** and **OpenFL**"* and *"unless I am done with a project I don't make its code public. However, the source code of an early version of the city generator is available on GitHub… Algorithms I use are not 'proprietary', neither they are secret and anything uncommon usually gets explained in one of the posts on my Patreon."*

**MFCG's last update is 0.11.5 (Feb 3 2025).** There is no 0.11.3 devlog (unannounced hotfix). Full version list from the itch devlog index is at the end.

---

## 1. Per-devlog findings (verbatim)

### 0.8.0 — "new buildings, improved UI" (2020-09-17)
itch: `.../devlog/179534/080-new-buildings-improved-ui` · full text: `patreon.com/posts/41711473`

> "The problem with the old algorithm based on **recursive bisecting the original shape of a block** was that it produced a lot of triangles (or 'triangle looking quadrangles'). The new one is based on **Voronoi diagram** and it results in a fair amount of weird shapes, but overall layouts look more natural. It is not perfect (anything rarely is) and I am going to keep working on it. Also it crashes the generator occasionally. For all these reasons this new thing is **disabled by default** - look for the **Options > Style > Buildings > Improved lots** to try it out."

> "Some of the features which were only accessible through shift/ctrl-clicking stuff before now can be reached via the **context menu**. For example, to reroll a castle shape right-click it and choose **Reroll geometry**. In the same way it is now possible to reposition the legend: right-click it and choose at what corner of the map you want it to be."

itch comments (verbatim):
- **Starkium**: "you should plug in the result to houdini and see what you get."
- **Olive** (+1): "I love voronoi diagrams! Toggling it on seems to also make the buildings smaller / more dense, especially on the larger maps. But they look great!"

### 0.8.1 — "major UI changes" (2021-02-03)
itch: `.../devlog/219273/081-major-ui-changes` · full text: `patreon.com/posts/47063541`

> "Most frequently used actions are accessible via the **context menu**… The rest of controls are distributed over three separate windows: **'Generate', 'Settlement' and 'Style'**. You can open, move and hide them independently and their positions are stored between sessions."

> "You can specify the **size of a city in 'wards': Generate > Size**. It's not a much more precise method than using *'Small'*, *'Medium'* and *'Large'* buttons, but this way you can create cities **larger than 'Large' (e.g. 100)**."
> "In addition to 'Default' and 'Maximum' number it is now possible to generate a city with a *specific* number of roads: **Generate > Roads > Number**. For example, you can build a **city without roads at all**."
> "A generated city can be stored (**Settlement > Copy URL**) and restored later (**Generate > From URL**). As in the non-itch version, any changes made to a city are **not encoded into the resulting URL**, so it's not a replacement for a real save/load feature."

Updates appended to the post: *"Apparently that 'Copy URL/From URL' thing doesn't work because the generator can't access the clipboard."* / *"'Copy URL/From URL' works now (sort of)…"*

itch comments: **Lithimlin** (+1) "I can finally tell the generator how many roads I want :D"; **BadgerFiend** (+1) "Great to have SVG support so I can drop in and make modifications in Inkscape."

### 0.8.2 — "basic integration with Armoria" (2021-03-03)
itch: `.../devlog/228034/...` · full text: `patreon.com/posts/48290708`

> "Its only new feature is basic integration with Azgaar's heraldry generator **Armoria** - it is possible now to add an **emblem/coat of arms** to a city map."
> "you can't define a specific design for an emblem, the only option is to request another random one."
> Planned: "An ability to **import heraldry designs created in the Armoria editor**. You'll need to copy a specific link in the editor and paste it in MFCG." / "More options for emblem placement. It will be possible to **embed an emblem into the legend** or specify a corner of the map." / "**Emblem tinting.** By default Armoria uses a neutral palette and sometimes its colours look out of place on a map. This is easy to fix by adding a bit of 'map colour' to them."

No comments on itch. **[app bundle]** hard-coded URLs: `https://azgaar.github.io/Armoria` and `https://armoria.herokuapp.com`.

### 0.8.3 — "assorted improvements" (2021-04-15)
itch: `.../devlog/242933/...` · full text: `patreon.com/posts/50057173`

> "**Improved lots** — In 0.8.0 I introduced 'improved lots'… The problem was that this method of lots generation **crashed the generator far too often**. I have finally found and fixed the bug which caused crashes and now I encourage everybody to use this option."
> "**Improved integration with Armoria** — It is now possible not only to 'reroll' the coat of arms… but also to **assign a specific design** to it (*Customize* in the context menu). Another new feature is that the coat of arms is **embedded into the legend** when the legend is on."
> "**Parameters for 'tints'** — Tints is a new name for **'watercolours'**. In the 'Color scheme' dialog you can now specify how tints (or should it be 'shades'?) are derived from a basic colour. There are three different methods - ***Spectrum, Brightness and Overlay***. There is also '***Strength***' parameter to define how pronounced the effect should be."
> "**Exported JSONs include districts descriptions now.** The current version of City Viewer doesn't use this information, but future ones will, to make buildings of different districts visually distinguishable."
> "…an ability to **collapse tool windows** (*Generate, Settlement* and *Style*) by clicking their headers."

itch comments: Eldarion77 "Great!", puwumats "babe wake up, new watabou update", MrShinyBoots, doorknob22 — no technical content.

### 0.9.0 — "new alleys and buildings" (2022-01-11)
itch: `.../devlog/334289/...` · full text: `patreon.com/posts/61026228`

> "**New streets** — Alleys used to be generated by **simple recursive bisection of map cells**. Now they are created using **'twisted bisection'** (I need to come with a better name for it) like in the Neighbourhood Generator. The effect is not as pronounced as it could be if processed areas were larger, but it's visible and I like it."
> "Alleys are made **wider** to accentuate their shape… Ideally, the width of streets, the average building size and similar values should be editable, but there are **too many parameters in this generator as it is**."
> "**New buildings** — instead of the 'Improved lots' checkbox, there is now a dropdown labelled **'Lots method'** containing three values: ***Bisection, Voronoi and Twisted***. This new 'twisted' method is the same as the one in the neighbourhood generator… for my taste this method is currently the best-looking-on-average one."
> "The **'Tight'** checkbox is replaced with the **'Processing'** dropdown… It contains three value: **'None'** leaves created lots as they are. **'Shrink'** makes lots a bit smaller (same effect as unchecking 'Tight'). **'Offset'** **shifts the front side of every lot to make lines of facades uneven**. It works best with the new 'twisted' lots."
> "The **'No triangles'** checkbox is renamed into **'Filter lots'**…"
> "A new type of towers is added - **half-towers** (but in the generator they are called **Open**)."
> "An option **not to outline roads**… When **hatching** is enabled, non-outlined roads are drawn as **dashed lines**."
> "**SVG export was completely reworked.** A huge amount of code was replaced with a much smaller amount of code and now the **only feature not supported in SVG is hatching**."
> "The bug with 'verylongdistrictnames' in the non-itch version is fixed."
> **What's next:** "The next big thing I'd like to improve in this generator is the **river/coast system**… My goal will be to make the generator capable of building a city on **any land-water configuration including one or more islands, confluence of rivers etc.**"

itch comments: **garrus505** (+1) requested river control, city size/sprawl options, multi-layered walls, island/peninsula modes; **Gazook89** (+2) asked for rotatable landmark bubbles.

### 0.9.1 — "trees and other visual changes" (2022-02-09)
itch: `.../devlog/345262/...` · full text: `patreon.com/posts/62336213`

> "**Trees** — There are still no forests in the generator, but some trees are added where this makes sense in my opinion: **in city greens, in empty spaces inside blocks (shared courtyards), occasionally between farm fields.**"
> "By default the trees are hidden; to display them you need to check **Style > Misc > Show trees**. Specially for them a new colour was added to colour schemes (**Color scheme > Additional > Trees**). **Trees are exported in JSON** as you may notice if you open an exported file in the City Viewer."
> "Unlike in the Village Generator, there is **no way here to adjust the amount of trees**… This may change if I decide to implement something like **groves** after all. I used to argue that woods tightly surrounding a city are historically unrealistic, but for fantasy settlements this argument is irrelevant, so **woods are not off the table**."
> "**Fonts** — It is now possible to change fonts for all kinds of text on a map. Currently there **5 of them: Title, Labels, Legend, Pins** (the same font is used for legend pins and POI pins) **and Elements** (scale bar and compass rose)… in MFCG these font settings are **not a part of loadable styles**. Instead, a new tab **Text** in the Style window is added for them. The dropdown **Font size (Small, Medium, Large)** is still there as well."
> "**Weathered roofs** — When '**Weathered roofs**' (**Style > Graphics**) is checked, **each roof is drawn in its own slightly different colour**… How subtle this effect is, is defined for each colour scheme individually (**Color scheme > Tints > Weathering**)."
> "**Outlining** — 'Buildings > No outline' and 'Misc > Outline roads' options were moved to its own new tab **'Outline'** and augmented by **'Outline water'** and **'Outline trees'** options."
> "A new separate colour is added for **city walls**. For custom colour schemes I suggest to make walls at least slightly lighter than the 'Dark' colour."
> "A new colour scheme called **'Natural'** is added to presets. It is similar to Neighbourhoods' 'Cool' one."
> "The **'Default' and 'Night' preset colour schemes are changed** a little. The **'Blueprint' preset is removed**."
> "Maps are **cropped differently ('more correctly') when exported as SVG**."
> "**Farm fields are spawned a bit differently to make sawtooths of farmland borders less visible.**"
> "**'Simplified water' option (Style > Misc) is removed.**"

itch comment thread — **the only in-thread Watabou technical answer in this set**:
- **Quenten**: "The trees ar FAR too big - some measuring more than 25 m… reduce them by a factor of 3 at least."
- **watabou** (reply): individual trees are *"clusters of greenery or 'micro groves'"* rather than single specimens — *"Why would anyone want to have every tree in a city to be mapped?"* — and admits the overall scale may be off: *"Buildings often seem way too large."*

### 0.9.2 — "assorted new features and improvements" (2023-02-24)
itch: `.../devlog/494237/...` · full text: `patreon.com/posts/79147510`

> "I needed to fix the **'export='** feature here and the rest of the changes are just random items from my todo list."
> "you can now **open any building on a city map in Procgen Mansion**."
> "A new mode called **'Pinch'** was added to the Warp tool. Its effect is **opposite to the one of Bloat**."
> "A new option called **'Solids'** was added (**Style > Misc**). When it is checked, **large buildings (i.e. Citadel, Temple and churches) are drawn in the same colour as city walls**."
> "**there are more of them [churches] spawned now**… they are **relatively large buildings (larger than regular ones, but usually smaller than the Temple) and each of them has a small square next to it**."
> "the **Night preset was removed**, the **B&W was made more black-and-white, less greyscale**. The **Medium colour was removed** and the **Light color is now called Compass**, because it's the only element it is used for."
> "**'Hatching' option is removed.**"
> "**Trees were made fluffier and a little smaller.** I use a different, much faster way to place them now. The side effect is that there seems to be more of them spawned."
> "**Much fewer secondary plazas** are generated. They look ugly and maybe I should remove them completely."
> "**Map labels (both curved and straight) look better now** thanks to some ideas from Perilous Shores."
> "This generator is already quite old and over time it's getting more and more difficult to add new features. At some point, I'll either have to **rewrite it from scratch**, or at least spend some time on a thorough refactoring…"

itch comments incl. **watabou replies (verbatim)**:
- **ascariel**: "How did you manage to set the aspect ratio of the map above?" → **watabou**: *"It is not possible to set the aspect ratio of a city, but when it is exported (PNG/SVG), the aspect ratio of the resulting image matches the aspect ratio of the city."*
- **aldanjam52**: "This update completely changed the districts in the map I was working on last night, how can i fix this?" → **watabou**: *"No, sorry. That happens sometimes with new updates (so it's good I don't update this often)."*
- **Kacey Pink** (+2): "universities would be cool… graveyards would be nice to have on the map; city watch towers not anchored to walls, they could sit at intersections of districts"
- **Corvagan**: asked for multiple rivers in a town.

### "Keyboard shortcuts and mouse actions" (2023-02-25) — **not truncated, full list**
itch: `.../devlog/494692/keyboard-shortcuts-and-mouse-actions`

**Keyboard shortcuts:** `Enter` generate a new city · `Tab / G` toggle Generate window · `T` toggle Town window · `S` toggle Style window · `O` open the Outline tab of the Style window · `C` open Color scheme window · `W` switch to Warp mode · `L` toggle label mode · `D` toggle grid · `B` toggle buildings · `A` toggle alleys · `N` toggle thin lines

**Mouse actions:** `Cmd(Ctrl)+click` a ward to reroll its inner geometry · `Shift+click` a district to zoom in · `Shift+click` the compass to reroll it · Roll the mouse wheel over the compass to rotate it · `Cmd(Ctrl)+click` the compass to reset it

**Warp mode keyboard:** `Enter` submit changes and exit · `Esc` discard changes and exit · `D` Displace · `R` Rotate · `L` Liquify · `X` Relax · `B` Bloat · `P` Pinch · `M` Measure · `E` Equalize · `+/-` increase/decrease the effect area size. **Warp mouse:** wheel = effect area size.

*(The live 0.11.5 build adds shortcuts not in this list — see §3.)*

### 0.10.0-alpha (2023-08-18) — **the most algorithmically detailed post**
itch: `.../devlog/576591/0100-alpha` · full text: `patreon.com/posts/87882877`

> "The alpha is available at a separate location: **https://watabou.github.io/city-generator/0.10.0**."
> **"Here is how the generator works: first, the map is partitioned into cells, which I call *patches*. Then, a few central patches are marked as 'city'. Most of the city patches become 'regular' patches, and these regular patches are cut into city blocks, and those cuts become streets."** "The problem with this approach is that this original cells are **clearly visible on the map**. There are no long roads running through a whole district, every street is contained within its patch (**'main roads' radiating from the centre of the city have a completely different nature**)."
> **"What I have been planning to try for a long time is to *merge patches and build streets district-wide*. And it worked! This change makes cells almost invisible and often there is an illusion of streets following some kind of underlying landscape. There is no underlying landscape of course, it's just 'twisted bisection' propagating properties of the outer shape inside."**
> "The most problematic is the **twisted bisection** itself… For complex concave shapes it often produces far from perfect results and such defects as **collapsed or intersecting edges** can easily break it completely. In practice it manifests as: **Empty areas where they clearly shouldn't be, e.g. inside city walls** (you can try rerolling this area via the context menu or by shift-clicking it); **Generator not responding**; **Browser not responding**."
> Other improvements in the alpha:
> - "Things like the **coast, city walls** etc are **much better smoothed** now. It's especially noticeable with **roads, which looked too jagged within city limits** before."
> - **"Improved outskirts filtering. To make city outskirts look less urbanized, the generator decreases the *density of streets* there, while keeping the *density of buildings* along those streets relatively high."**
> - **"Cities are made larger on average. For example Medium cities are made of 20-40 patches instead of 12-25 as before."**
> - "**'Local churches'** are generated more reliably now meaning that there are more of them and they don't tend to disappear after rerolling a ward."
> - "Cities are **framed better** now (both on screen and when exported) leaving **more space around small cities and less around large ones**."
> - **"A new 'modern' colour preset is added."**

itch comments — **key JSON-schema answer from watabou**:
- **HuguesGauthier**: is the JSON export valid GeoJSON for QGIS? → **watabou**: the format was initially GeoJSON-based but he made modifications for convenience, so *"it just resembles GeoJSON without being compatible with anything."*
- HuguesGauthier follow-up mentions a **PHP conversion script by "Tom"** to convert MFCG JSON to valid GeoJSON; asks what language the source is → **watabou**: *"Haxe. It is not an exotic language."*

### 0.10.1 (2024-02-21)
itch: `.../devlog/685971/0101` · full text: `patreon.com/posts/98918904`

> "The generator **doesn't freeze anymore** (as far as I can see)… The generator**s** crashes very occasionally… The generator still glitches occasionally. **The most common glitch looks like an empty area on a map where there shouldn't be one.** …you can always reroll either the corrupted part of the map (**ctrl+click**) or the whole map."
> "I've made a few improvements to the **shapes of curved alleys and district borders**. These should make alleys look more organic and at the same time reduce the number of glitches."
> "the changes made in this version make it possible (or much easier) to implement some big new features, including **more diverse land/water configurations**. People have been asking for **river confluences and islands** for a long time, however for me personally the most important thing would be **more interesting coasts and wide rivers**. To be honest, I feel like almost every detail of the generation (let alone UI) needs upgrading - **farms, districts, city walls, harbours, castles**…"

itch comments: **dranorter** reported "a large black rectangle or the whole background will come out black" on mobile → **watabou**: *"It sounds like the maximum texture size available in your phone's browser is less than what the generator requires. I don't think I can fix this now, but hopefully I'll find a way around it in the future."* (corroborated by the app's export area caps, §3).

### 0.10.2 — "alleys view" (2024-03-16)
itch: `.../devlog/698858/0102-alleys-view` · full text: `patreon.com/posts/100431269`

> **"There are two types of roads in the city generator: relatively wide *major roads* running from a city centre to the edges of a map and narrow *minor roads or alleys*. Actually, there are two types of alleys which are quite different from each other… before this update, only major roads were drawn explicitly, and alleys existed only as *empty spaces separating rows of houses*."**
> "By default, they are hidden and you need to check the **'Show alleys'** option in the Style window (or press **A**) to enable them. **If enabled, they get included in exported jsons and will be visible in City Viewer.**"
> "It is now possible to **hide all the buildings** on a map (choose **Hidden** as the Display mode in **Style > Buildings** or press **B**). Apart from the regular buildings, it also affects **farm houses, but not the citadel, temple or city walls**. The main reason to implement this option was to make it possible to view a **street map** of a city."
> **"The Farms option has been removed from the Generate window. Instead, farm fields are now always created as a part of city generation, but they can be hidden (Style > Misc > Farm fields). There is also an option to draw fields not as sets of furrows, but as solid shapes."**
> "**Trees** have been made **smaller and more irregular** in shape. They are now drawn using the **same algorithm as in Neighbourhood Generator, but with fewer details**."
> "**City names and district names have been reworked.** Not sure they got better, but the code is much simpler and cleaner now."

### 0.11.0 — "roof details and district view" (2024-04-08)
itch: `.../devlog/711706/...` · full text: `patreon.com/posts/101942512`
Companion theory post: **"Straight skeletons"** `patreon.com/posts/101173551` (2024-03-28)

Straight-skeleton post (verbatim):
> "if you take a polygon and start to **'dehydrate'** it, it will gradually get thinner, but its overall dimensions will remain the same. The **twig-like thing that remains in the end is the straight skeleton** of the original polygon. Straight skeletons are widely used for **finding ridges of a hip roof given the ground plan of a building**."
> "it turns out that it's **easier to come up with my own algorithm**, than deciphering academic papers or someone else's code… As far as I can judge, its **efficiency is O(n²)** which is fine for my use cases. The drawback… is that it **glitches in special cases**."
> "**Roof details look well on medium-sized city maps.** On small maps, roof ridges make imperfections of building shapes more visible, and on **large maps all the roof details blend together**. The second image is generated using a modified algorithm to produce **ridges of gable roofs**. Unfortunately, this modified algorithm works well only with 'clean' shapes, so maybe I'll reserve it for such **'grid-based' buildings as donjons, temples and farm houses**."
> Also: use straight skeletons for **curvilinear map labels** like Azgaar's FMG, and for **mountain ridges** from an island/continent polygon.

0.11.0 release post:
> "A new **Roofs** drop-down menu has been added to the **Buildings tab** of the Style window with three options: ***Plain, Hip and Gable***. The Hip and Gable options **make the generation a little slower**, but on my laptop the difference is not visible to the naked eye."
> "now hip and gable roofs interact with the **Raised** option. When the **Raised** checkbox (on the same tab) is checked, the roof details are drawn as if we look at them from a **slightly lower position, not exactly top-down**. In case of gable roofs, the implementation is flawed: when examined closely, the buildings **look like greenhouses**."
> "**District view** — Instead of implementing a real zoom feature (**which is too difficult for a specific technical reason**) and integration with the Neighbourhood Generator… I've added something in between: the **District View mode**. It is now possible to **zoom to a district making it fill the whole viewing area and hiding everything around it**. To zoom to a district, **right-click it and choose *Zoom in*, or just shift-click it**. To zoom out, right-click anywhere and choose *Zoom out*, or shift-click anywhere again."
> "the district view supports all the ways of interacting with a city map. You can reroll and warp geometry, try different visual options, **export the district as PNG or SVG. Export as JSON still exports the whole city.**"
> "District view looks a little like the Neighbourhood Generator… but everything is drawn exactly in the same way as in the 'city view'. So there are **no cupolas, shadows, cobbled roads** or any other niceties of NG."
> **"District view often looks disjointed with pieces of rivers, roads, city walls. To make it more whole, the district border is drawn explicitly as a thick semi-transparent dashed line."**
> "The **Equalize tool** (useful for **fixing shapes of plazas and castles**) has been improved."
> **"Towers: Bastions and Water isolines options have been removed."**
> "The **N** key now toggles **Thin lines**."

itch comment: **PliscoFlisco1893** reported difficulty loading towns over 100,000 people (no reply).

### 0.11.1 — "improved map labels" (2024-04-15)
itch: `.../devlog/715292/...` · full text: `patreon.com/posts/102377277`

> "The **previous algorithm was my own invention** and it worked surprisingly well considering how random were the assumptions it was built on. Otherwise it wasn't great - **labels often went beyond the borders of their areas and occasionally they were bent in the opposite direction** to what one would expect."
> **"The new algorithm is a widely used one (unfortunately, I don't know its name) and it's much more reliable. It's based on the idea of *straight skeleton* and essentially it is about drawing an area label along a 'ridge' of the area. Which ridge is most suitable for the purpose is not always obvious, so this can be implemented in different ways."**
> "a set of small… low level improvements… to address the problem of often **incorrect letter spacing** and a bunch of glitches related to **text outlining**."
> **"A new colour is added to the style settings: *labels*. This color is only used for map labels and pins, but not for the header, the legend itself or any other text elements."**
> **"The 'compass' colour is renamed to 'elements', because it is now also used for the scale bar and the legend."**
> **"A new type of element is implemented: *grid*. The size of the grid depends on the current scale (the grid is supposed to be used in conjunction with the scale bar). The grid can be disabled by unchecking the Style > Elements > Grid checkbox or by pressing the D key."**
> "**Lots method** combobox has been **removed**." / "**Filter lots** checkbox has been **removed**." / "**Display mode: Simple** option has been **removed**." / "**Processing: Shrink** option has been **removed**."
> **"Farm fields and city and castle walls (Style > Outline) can be drawn outlined now."**

### 0.11.2 — "small improvements and bug fixes" (2024-08-12)
itch: `.../devlog/780847/...` · full text: `patreon.com/posts/109852547`

> "It consists of numerous tweaks and fixes, most (but not all) of them **related to rivers and coastlines** (they affected **bridges, piers, water gates** and their overall shape, among other things). It is not very obvious, but **bays are generated differently now and they're a bit more diverse**. The downside of this change is that **'headlands' (inverted bays) no longer happen**. I don't think it's a huge loss, because those headlands were ugly. I am going to reintroduce them later and better."
> **"MFCG has got its own styles page now. This generator doesn't expose too many style options, but at least it allows you to completely recolour maps… For now, there are only 9 colour schemes (and 6 of them are standard presets), so I'll need to add more to make this page useful."** *(the page now lists 11 — see §4)*

### 0.11.4 — "forests" (2024-10-18)
itch: `.../devlog/817711/0114-forests` · full text: `patreon.com/posts/114184619`

> "When MFCG was first released and these cities were **barely more than stylized Voronoi diagrams**, one of the first requested features was the ability to add surrounding forests."
> "I used to argue that it's just **too unrealistic to have forests so close to the city edges, they would be cut down**… but since there is 'fantasy' in the name of the generator, historical accuracy is kind of negotiable :) Also, forests **fill empty spaces around cities nicely (they look better than farmland), so they can be treated as a sort of frame**."
> **"Forests are disabled by default. To enable them, check *Style > Misc > Show forests*."**
> **"When enabled, forests fill all available space (i.e. not occupied by the city, farmland or water) on the map."**
> **"I was originally going to let roads push the forest apart. In the end I decided that roads going 'under' the forest looked better."**
> "At the last moment I discovered that **on large maps forest edges look too straight** and not great overall."
> Next: "experiment with some visual options… **shades and shadows, nicer roofs** etc."

itch comments: **ValeryNorth** (+1) asked for indicating road paths beneath foliage; **develroo** (+3) noted medieval European cities "relied on them for ship building"; **tmexx** (+2). No watabou replies.

### "Experiments" (2024-10-28) — unreleased render research
itch: `.../devlog/823841/experiments` · full text: `patreon.com/posts/114858238`

> "**none of these features are present in the currently published version of the generator, some of them I'm not planning to release at all.**"
> **"Higher buildings** — In the current version there is a buildings option called 'Raised'. Here I raise building roofs **higher and not uniformly across the map**. It's not just changing a single value in the code though, as even for such a simple change I had to implement a **sort of z-sorting**."
> **"Shadows** — …to enhance the effect I add **hard walls shading and ground shadows**. This looks nice (and a bit too dramatic), but **not very readable**."
> **"Shaded roofs** — In the current version gable and hip roofs are drawn as **sets of lines, more like wireframes than surfaces**. To make them look solid, here I **draw their faces as filled polygons omitting the ones that don't face the viewer**. And since I'm drawing them as polygons, why not to **shade them properly**."
> Why the "**military projection**" branch is abandoned: "these maps look fancy, but they are **not readable**… **The drawing gets much slower with all the checks, sortings and 10x more polygons**… **there are no city/castle walls on these images? That's because they are much more difficult to draw raised. And there is the same problem with trees.**"
> "I mentioned before that maybe I might make an **'urban location' generator** for such places as **squares, alleys, crossroads, bridges** - like the Neighbourhood Generator, but more focused. Probably the military projection would be a good match for it."
> **"Hatching** — …roofs on the image above seem **too smooth, like plastic**. I can try to fix this by adding a **texture to them, for example the hatching like in the VG and NG**."
> "I think I'll **add shaded roofs and ground shadows in the generator eventually**." (as of 0.11.5, still not shipped)
> Bonus images: **"town on a hill"** and **"city in the night"**.

itch comments: **SirCumferance** (+3); **scott2020** "Using colors with it would make it awesome." → **explosiveghast**: "If you right click, Colors is already an option. Enter the hexcodes you like!"

### 0.11.5 — "Three generators have been updated" (2025-02-03)
itch: `.../devlog/880636/...` · full text: `patreon.com/posts/121415691`

MFCG section, verbatim in full:
> "The only change in this generator is that the **bug where forests could not be exported correctly is now fixed**. Well, I hope it is fixed - the fix is based on some assumptions which I can't really verify. **A map with forests enabled is now exported at a lower resolution than the same map without forests, but the difference depends on several parameters.** If the resolution seems too low for you (or the fix doesn't work for you at all), **please use SVG export for now.**"

No comments on itch. (Dwellings got `Misc. > Hatching` hatched walls; VG got `Layers > Roads` hiding — not MFCG.)

---

## 2. URL query parameters — complete and exact **[app bundle 0.11.5]**

From `Blueprint.fromURL()` / `updateURL()` in `mfcg.js`. Base URL: `https://watabou.github.io/city-generator/?...`

| Param | Type | Default in `fromURL` | Notes |
|---|---|---|---|
| `size` | int | `0` | **number of patches/wards**. If `0` or `seed==0`, URL is ignored. Custom-size UI accepts **5–200** |
| `seed` | int | current RNG seed | required together with `size` |
| `name` | string | – | city name |
| `population` | int | `0` | if `0`, population is computed (§3) |
| `citadel` | flag | `true` | |
| `urban_castle` | flag | `false` | "Inner castle"; **checking it force-checks `citadel`; unchecking `citadel` unchecks it** |
| `plaza` | flag | `true` | |
| `temple` | flag | `true` | |
| `walls` | flag | `true` | |
| `shantytown` | flag | `false` | |
| `river` | flag | `false` in `fromURL` (`true` in prefs default) | |
| `coast` | flag | `true` | |
| `greens` | flag | `false` | UI label "Greens"; **prefs key is `green` (singular)** — the URL key is `greens` |
| `hub` | flag | `false` | "Maximum number" of roads/gates |
| `gates` | int | `-1` | `-1` = default count; a specific number overrides `hub` |
| `sea` | float | `"0.0"` | `coastDir` — coast direction/bearing. Written only when `coast` is on |
| `export` | string | – | `json` \| `png` \| `svg` (case-insensitive) — auto-exports on load |
| `style` | string | – | style name |

`updateURL()` writes: `size, seed, name?, population?(>0), citadel, urban_castle, plaza, temple, walls, shantytown, coast, river, greens`, then `hub` **or** `gates`, then `sea` if coastal. **Note: `farm` is not a URL parameter** — the Farms option was removed from the Generate window in 0.10.2.

**Azgaar FMG hand-off** (`getFMGParams`, Settlement > Overworld → `https://azgaar.github.io/Fantasy-Map-Generator/`):
```
{ size: nPatches, seed, name, coast: shore?1:0, port: anyLanding?1:0,
  river: canals.length>0?1:0, sea: shore? bp.coastDir : 0, from: "MFCG" }
```

---

## 3. Generation algorithm — exact formulas **[app bundle 0.11.5]**

**PRNG** — Lehmer/MINSTD: `seed = (48271 * seed) % 2147483647`, float = `seed / 2147483647`.

**City size** (`a` = size in patches):
- Buttons: **Small** = `floor(10 + rnd*10)` → 10–19; **Medium** = `floor(20 + rnd*20)` → 20–39; **Large** = `floor(40 + rnd*40)` → 40–79. Table `sizes = {small:{min:10,max:20}, medium:{min:20,max:40}, large:{min:40,max:80}}`. Default `nextSize = 25`.
- Custom size accepted only if `5 <= n <= 200`.

**Random feature probabilities** (when "Random" is checked), `a` = size:
```
walls        = rnd < (a + 30) / 80
shantytown   = rnd < a / 80
citadel      = rnd < 0.5 + a/100
urban_castle = rnd < (walls ? a/(a+30) : 0.5)
plaza        = rnd < 0.9
temple       = rnd < a / 18
river        = rnd < 0.6666666666666666        // 2/3
coast        = rnd < 0.5
```
`Greens` and `Farms` are `nonRandom` — never randomised.

**Gate count** (`CurtainWall.buildCityGates`):
```
gates = bp.gates > -1 ? bp.gates
      : bp.hub      ? wallShape.length            // one per wall vertex = "Maximum"
      : 2 + int( walledPatches/12 * (coastal ? 0.75 : 1) )
```
Gate placement is weighted; after picking a gate at index `d`, every other candidate weight is multiplied by `max(0, circularDistance-1)` so gates repel each other.

**Parks / greens** (`createWards`): if the citadel's first gate touches exactly 3 cells, with probability `1 - 2/(nPatches-1)` all three become Parks. Then total parks target = `(nPatches - 10)/20` (integer part + fractional part as a probability), placed on random inner patches.

**Temple/Cathedral**: placed on the free inner patch whose shape-centre is closest to the origin.

**Suburbs at gates**: for each wall gate, with probability `1 - 1/(nPatches - 5)`, the cells around it are flagged `withinCity` and get `Alleys` wards (this is how development spills outside the walls).

**Shanty towns** (`buildShantyTowns`): number of added patches = `nPatches * (1 + rnd³) * 0.5` (i.e. between `0.5·n` and `1.0·n`). Candidate weight = `k² / d(centre)` where `k` = count of already-urban neighbours and
`d(p) = min( 3·dist(p, cityCentre), 2·dist(p, any road vertex), dist(p, any shore vertex), dist(p, any canal vertex) )²`.

**Farmland vs wilderness** (`buildFarms`): for each un-warded, non-water cell not bordering the shore, with `a = 2·avg(3 rnd)`, `b = avg(3 rnd)`, `c,d = rnd·2π`, and `θ` = bearing from city centre:
```
g = a·sin(θ + c) + b·sin(2θ + d)
if dist(cell, centre) < (g + 1) · maxCityRadius  → Farm ward
else                                              → Wilderness ward
```
So farmland extent is a **two-harmonic lobed envelope** around the city. Farm constants: `MIN_SUBPLOT = 400`, `MIN_FURROW = 1.3`.

**Harbour piers**: along the longest waterfront segment of length `h`: `n = int(h/6)` piers, each **8 units long** perpendicular to the shore, centred with margin `(1 - 6(n-1)/h)/2`.

**Ward-group merging** (the 0.10.0 "district-wide streets"): patches are grown into a `WardGroup` by flood-fill; growth continues while `rnd < (n-3)/n` where `n` = current group size.

**Per-district street parameters** (`District.createParams`, `r` = independent randoms):
```
alleys.minSq       = 15 + 40·| (r+r+r+r)/2 − 1 |
alleys.gridChaos   = 0.2  + ((r+r+r)/3)·0.8
alleys.sizeChaos   = 0.4  + ((r+r+r)/3)·0.6
alleys.shapeFactor = 0.25 + ((r+r+r)/3)·2
alleys.inset       = 0.6 · (1 − |(r+r+r+r)/2 − 1|)
alleys.blockSize   = 4    + 10·((r+r+r)/3)
alleys.minFront    = sqrt(minSq)
greenery           = ((r+r+r)/3) ^ (type == PARK ? 1 : 2)
if type == SPRAWL:  gridChaos *= 0.5;  blockSize *= 2;  greenery = (1+greenery)/2
```

**Forests / trees** (`Forester`):
```
pattern = PoissonPattern(30, 30, 2.25)     // 30×30 grid, min radius 2.25
noise   = fractalPerlin(octaves=5, baseGridSize=0.05, persistence=0.5)
fillArea(poly, density=1): scatter pattern points; keep p if (noise(p.x,p.y)+1)/2 < density
fillLine(a,b,density=1):   n = ceil(dist(a,b)/3) candidates jittered along the line; same noise test
```
Perlin uses the standard Ken Perlin permutation table and a 4096-entry precomputed `6t⁵−15t⁴+10t³` smoothstep LUT.

**Population** (`TownInfo.update`): `pop = bp.population; if (pop == 0) pop = 6 × buildingCount;` then rounded **up to 2 significant digits**. Displayed as `"Number of buildings: N\nPopulation: ~P"`. So **≈ 6 people per building**.

**Map scale** (`UnitSystem`): `meters = ("m", 0.25)`, `yards = ("yd", 0.2286)`, `metric = ("km", 250, meters)`, `imperial = ("mi", 402.336, yards)`. Default `metric`. → **1 map unit = 4 metres** (250 units = 1 km; 402.336 units = 1 mile = 1609.3 m). 

**Wall geometry constants**: `THICKNESS = 1.9` (=7.6 m), `TOWER_RADIUS = 1.9`, `LTOWER_RADIUS = 2.5` (=10 m); gate towers get radius `1 + 2·TOWER_RADIUS`.

**Stroke widths**: `strokeNormal = 1.6`, `strokeThin = 0.8`, `strokeThick = 3.2`.

**District-view border** (`FocusView`): `lineStyle(5 × lineInvScale, black, alpha 0.4)` drawn as a **dashed polyline with dash = gap = 2× that width** — i.e. the "thick semi-transparent dashed line" from the 0.11.0 post.

**PNG export resolution cap** (`Export.asPNG`) — explains the 0.11.5 forest fix and the mobile black-rectangle bug:
```
pad = 40 × (districtView ? 0.25 : 1)
d = viewport.width + pad ;  f = viewport.height + pad
c = sqrt( min( 16777216 / (d·f),   67108864 / maxLayerArea ) )     // 4096² and 8192²
outW = c·d ;  outH = c·f
```
Exported PNG aspect ratio therefore always matches the city's (matching watabou's comment reply on 0.9.2).

**Named class list** (`com.watabou.mfcg.*`) confirming the internal model:
`model.wards.{Alleys, Castle, Cathedral, Farm, Harbour, Mansion, Market, Park, Ward, WardGroup, Wilderness}`, `model.{Blueprint, Building, Canal, Cell, City, CurtainWall, District, DistrictBuilder, DistrictType, DocksGrower, Forester, Grower, Landmark, ParkGrower, Topology, UnitSystem}`, `model.blocks.{Block, TwistedBlock}`, `annotations.{Equator, Ridge}` (Ridge = straight-skeleton label spine), `scenes.tools.{Bloat, Displace, Equalize, Liquify, Measure, Pinch, Relax, Rotate, Warp}`, `scenes.overlays.{Compass, CurvedLabel, Emblem, Frame, GridOverlay, Labels, Legend, Marker, Pin, ScaleBar(New/Old), Title}`, `export.{Export, JsonExporter, SvgExporter}`.

**Ward `getLabel()` strings** (hover tooltip): `"Castle"`, `"Farmland"`, `"Harbour"`, and for all other wards **the district's generated name**.

**DistrictType enum** (9 values): `CENTER(plaza)`, `CASTLE(castle)`, `DOCKS`, `BRIDGE(bridge)`, `GATE(gate)`, `BANK`, `PARK`, `SPRAWL`, `REGULAR`.

---

## 4. Colours, palettes and hex values

**Style window tabs (0.11.5):** `Graphics · Elements · Buildings · Outline · Text · Misc`

| Tab | Controls (prefs key, default) |
|---|---|
| Graphics | `Color scheme` button; `Thin lines` (`thin_lines`, false); `Tint districts` (`watercolours`, false); `Weathered roofs` (`weathered_roofs`, false) |
| Elements | `Font size` (`text_size`, Small/Medium/**Large**, default index 1); `Districts` (`districts`: Hidden/Straight/**Curved**/Legend); `Landmarks` (`landmarks`: Hidden/**Icon**/Legend); checkboxes `Title`(`city_name`,true), `Scale bar`(true), `Emblem`(false), `Grid`(true), `Compass`(true) |
| Buildings | `Display mode` (`display_mode`: Block/**Lots**/Complex/Hidden); `Processing` (`processing`: None/**Offset**); `Roofs` (`roof_style`: **Plain**/Hip/Gable); `Raised`(true); `Solids`(`draw_solids`,true) |
| Outline | `Buildings`(true), `Solids`(false), `Water`(true), `Roads`(true), `Trees`(true), `Fields`(false), + `Toggle all` button |
| Text | 5 fonts: `font_title`, `font_label`, `font_legend`, `font_pin`, `font_element` |
| Misc | `Show alleys`(false); `Show trees`(false); `Show forests`(false, **only enabled when Show trees is on**); `Towers` (**Round**/Square/Open); `Farm fields` (key is misspelled `farm_fileds`: **Furrows**/Plain/Hidden) |

**Colour slots (10):** `colorPaper, colorLight, colorDark, colorRoof, colorWater, colorGreen, colorRoad, colorWall, colorTree, colorLabel` — plus `tintMethod`, `tintStrength`, `weathering`.

**Built-in presets (6, keys `1`–`6`):** `Default;default;Ink;ink;Black & White;bw;Vivid;vivid;Natural;natural;Modern;modern`. Swatch preview uses `[colorPaper, colorRoof, colorDark]`.

**Downloadable styles page** `https://watabou.github.io/city_styles.html` — 11 total: **fairytale, tapestry, academia, turquoise, june, default, ink, b&w, vivid, natural, modern** (files at `https://watabou.github.io/styles/city_<name>.json`; `bw` for b&w).

Full palettes (verbatim JSON):

| style | Paper | Dark | Roof | Water | Green | Road | Wall | Tree | Label | Light | tintMethod | tintStr | weather |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **default** | `#CCC5B8` | `#1A1917` | `#A5A095` | `#7F7A71` | `#A59F93` | `#CCC5B8` | `#1A1917` | `#7F7A71` | `#1A1917` | `#CCC5B8` | Brightness | 30 | 20 |
| **ink** | `#CCCAC2` | `#130F26` | `#9A979B` | `#6C6974` | `#A5A2A2` | `#CCCAC2` | `#130F26` | `#47454C` | `#150C3F` | `#BFBFBF` | Brightness | 40 | 30 |
| **bw** | `#FFFFFF` | `#000000` | `#DDDDDD` | `#FFFFFF` | `#EEEEEE` | `#FFFFFF` | `#000000` | `#EEEEEE` | `#000000` | `#FFFFFF` | Brightness | 0 | 0 |
| **vivid** | `#FFF2C8` | `#4C5950` | `#D6A36E` | `#779988` | `#C3CC99` | `#FFF2C8` | `#606661` | `#667755` | `#2D3D4C` | `#F2F2DA` | Spectrum | 20 | 25 |
| **natural** | `#BFBFB5` | `#3F322C` | `#66707F` | `#8F9997` | `#8D927B` | `#E1DBD5` | `#4C4C4C` | `#777F66` | `#662C28` | `#D8D8CD` | Spectrum | 20 | 30 |
| **modern** | `#E5E5DA` | `#333333` | `#E5B75B` | `#59A3B2` | `#CCCCA3` | `#CCCCC1` | `#666660` | `#777F66` | `#222222` | `#D8D8C3` | Overlay | 25 | 25 |
| **fairytale** | `#A5A552` | `#261C16` | `#7F543F` | `#66727F` | `#D8A641` | `#CCB7A3` | `#FFD8B2` | `#516655` | `#FFFFE5` | `#EEEEEE` | Overlay | 20 | 30 |
| **tapestry** | `#CCB28E` | `#1E2232` | `#8C4D5C` | `#95A59D` | `#A59D74` | `#B2946B` | `#66625B` | `#727F66` | `#1E2232` | `#E5CEA0` | Spectrum | 25 | 25 |
| **academia** | `#D7BA9C` | `#28263B` | `#7D83A5` | `#606277` | `#B28E7C` | `#CDC3A8` | `#FFEFBF` | `#8C7055` | `#1C1933` | `#FAF7A8` | Overlay | 20 | 20 |
| **turquoise** | `#D1B488` | `#281B12` | `#CB5644` | `#91B8A3` | `#998F4A` | `#E6DAC2` | `#F9F9DD` | `#344E4D` | `#212C48` | `#F9EDBD` | Overlay | 20 | 20 |
| **june** | `#BFC192` | `#262316` | `#8C8069` | `#ADC6CB` | `#929971` | `#DED9BC` | `#646152` | `#647650` | `#262316` | `#CCC2A1` | Spectrum | 8 | 20 |

**Tint derivation** (the "Parameters for tints" from 0.8.3), on HSV, `i` = district index, `n` = district count:
```
Spectrum(c,i,n)   = hsv( h − 360·(n−1)/n · strength/100 · (i/(n−1) − 0.5),  s, v )
Brightness(c,i,n) = hsv( h, s, v + min(v, 1−v) · strength/50 · (i/(n−1) − 0.5) )
Overlay(c,i,n)    = lerpRGB( c, hsv(h + 360·i/n, s, v), strength/100 )
```
A single-district city uses `colorRoof` unmodified.

**No paper texture / no hatching in MFCG.** The word "hatch" does not appear anywhere in the 0.11.5 bundle — hatching was removed in 0.9.2 ("'Hatching' option is removed") and only revisited as an unreleased experiment in the Oct 2024 Experiments post. The background is a flat `colorPaper` fill (`stage.set_color(K.colorPaper)`, PNG canvas initialised with `colorPaper`).

**Default embedded font:** `IM Fell Great Primer` (`https://fonts.googleapis.com/css2?family=IM+Fell+Great+Primer&display=swap`, generic `serif`). SVG export embeds it via `@import`. UI fonts: Share Tech / Share Tech Mono.

---

## 5. Export formats and JSON schema **[app bundle]**

Three formats via context menu `Export as ▸ PNG | SVG | JSON`, the Settlement window's Export dropdown, or `&export=png|svg|json`.

- **PNG** — filename `<cityName>.png`, resolution capped as in §3; aspect ratio = city aspect ratio.
- **SVG** — `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` + serialised tree; embeds Google-Fonts `@import`, gradients, and detects the Armoria emblem SVG for inlining. Line joints map `2→round, 1→miter, 0→bevel`; caps `1→round, 2→square, 0→butt`; blend modes `10→normal, 9→multiply, 0→plus-lighter`.
- **JSON** — `<cityName>.json`, MIME `application/json`. **GeoJSON-*like* but explicitly not GeoJSON-compatible** (watabou's own comment, 0.10.0-alpha thread). Coordinate `SCALE = 4` — since 1 map unit = 4 m, **exported JSON coordinates are effectively in metres**.

FeatureCollection members, in emission order:

| id | geometry | properties |
|---|---|---|
| *(no id)* | `Feature` | `id:"values"`, `roadWidth: 8` (=2·SCALE), `towerRadius: 7.6`, `wallThickness: 7.6`, `generator:"mfcg"`, `version:"0.11.5"`, `riverWidth: canal.width·4` (only if a river exists) |
| `earth` | Polygon | land outline |
| `roads` | GeometryCollection of LineStrings | each with `width`: arteries `8`; alleys `4.8` (=1.2·SCALE) — **alleys included only when `show_alleys` is on** |
| `walls` | GeometryCollection of Polygons | `width: 7.6` |
| `rivers` | GeometryCollection of LineStrings | `width: canal.width·4` |
| `planks` | GeometryCollection of LineStrings | `width: 4.8` — **piers and bridge decks** |
| `buildings` | MultiPolygon | content depends on `display_mode`: `Block`→block shapes, `Complex`→complex buildings, `Lots`→lots, `Simple`→rects; plus Castle building, Cathedral buildings, Farm houses |
| `prisms` | MultiPolygon | market **monuments** |
| `squares` | MultiPolygon | market/plaza open space |
| `greens` | MultiPolygon | Park ward greens |
| `fields` | MultiPolygon | farm sub-plots |
| `trees` | MultiPoint | **only when `show_trees` is on** |
| `districts` | GeometryCollection of Polygons | each with `name` property |
| `water` | MultiPolygon | **only if `waterEdge` is non-empty** |

**Import: none.** Settlement > Points of interest > `Load`/`Clear` reads an external `*.json` list of landmarks only (the 0.8.1 workaround watabou suggested in comments). `Permalink` writes the URL to clipboard.

---

## 6. Naming grammar (`Assets/grammar.json`) — district/ward vocabulary

**District noun tier** (`getDistrictNoun`): `n = faces.length + floor(rnd·3)` → `n≤2 → "quarter"`, `n<6 → "ward"`, `n<12 → "district"`, else `"town"`.

**Per-type rules**:
```
centralDistrict : "old #cityName#" | "old #districtNoun#" | "{trade|merchants|market} #districtNoun#"
castleDistrict  : COMPACT?-{castle|0.5?-citadel|0.2?-fortress} | !COMPACT?-{castle|military|upper} #districtNoun#
docksDistrict   : UNIQUE?-the #docksNoun# | UNIQUE&0.5?-#docksNoun# #districtNoun# | !UNIQUE?-{#adj#|#dir#} docks
parkDistrict    : UNIQUE?-the #parkNoun# | {#adj#|#proper#} #parkNoun#
bridgeDistrict  : #[_:#adj# #bridgeNoun#]_.merge# | 0.5?-#proper# #bridgeNoun#
gateDistrict    : #[_:#adj# #gateNoun#]_.merge# | 0.5?-#proper# #gateNoun#
bankDistrict    : #adj# #bankNoun#
sprawlDistrict  : UNIQUE?-new #cityName# | UNIQUE?-the slums | #dir# {#cityName#|slums} | #district# | #district#
docksNoun  : docks | port | harbour
bridgeNoun : bridge | 0.2?-ford | 0.2?-crossing | 0.1?-ferry
gateNoun   : gate | 0.5?-road | 0.1?-way
bankNoun   : bank | side | 0.2?-wharf
parkNoun   : green | hill | 0.5?-garden{s} | 0.2?-park | 0.1?-grove
place      : town, sprawl, village, side, end, reach, point, borough, edge, mile, yard, water,
             street{s}, square, {walk|row}, steps, pass, {valley|vale}, ridge, hill, mire, field,
             {wood|grove|park}, hook, market
obj        : {spring|brook}, {orchard|garden}, heath, rock, cliff, tower, {hall|lodge}, mill,
             {church|chapel|shrine|temple}, well, {market|fair}, wall, court, forge, crown, cross,
             crest, shade, star, ring, stair, arch, horn, knot
```
`COMPACT` = single-patch district; `UNIQUE` = only district of that type. Direction (`#dir#`: north/south/east/west, optional `-ern`) comes from the district's "equator" midpoint bearing (`Equator.marks = [0.5, 0.333, 0.666]`).

**City-name feature flags** (toggled by the blueprint): `CASTLE, WALLS, TEMPLE, PLAZA, SHANTY, COAST, RIVER`, driving:
```
feature : {hill|mount|rock} | {wood|grove} | field | cliff{s} | vale
        | CASTLE?-{castle|keep|tower|hold} | WALLS?-{wall|gate} | TEMPLE?-church
        | PLAZA?-{market|fair} | RIVER?-{river|falls|water|0.5?-ford}
        | COAST?-{sea|lake|coast|shore|beach|strand|wharf|port}
occupation flags: WALLS?-{king|lord} · CASTLE?-{knight|soldier|archer}
                  TEMPLE?-{priest|nun|pilgrim|prophet} · COAST?-{fisher|sailor}
adjPlace flag:    COAST?-sea
```

**Ward/district type names to note:** the model's ward classes are **Alleys, Castle, Cathedral, Farm, Harbour, Mansion, Market, Park, Wilderness** (+ base `Ward` for water patches). There is **no** cemetery, orchard (as a ward), warehouse, or shanty-town *class* — shanty town is not a ward type, it is extra `Alleys` patches added outside the walls by `buildShantyTowns`. "Orchard" appears only as a name-grammar noun. Cemeteries/universities/watchtowers were requested in comments (Kacey Pink, 0.9.2) and never implemented.

---

## 7. Live-build shortcuts not in the 2023 shortcuts devlog **[app bundle 0.11.5]**

`ViewScene.onKeyEvent` keycodes: `Tab`/`G` Generate window · `Enter` new city · **`1`–`6` load presets default / ink / bw / vivid / natural / modern** · `A` toggle alleys · `B` show Buildings tab (**Shift+B** toggles buildings visibility) · `C` Color scheme · `D` toggle grid · **`E` show Elements tab** · `L` cycle district labels (`Curved → Legend → Hidden → Straight → Curved`) · `N` thin lines · `O` Outline tab · `S` Style window · `T` Settlement window · `W` Warp.

Mouse: `Ctrl/Cmd+click` = `patch.reroll()`; `Shift+click` a district = zoom in, `Shift+click` again = zoom out. Right-click menu on a ward adds **"Reroll geometry"**, **"Zoom in"**, and **"Open in Dwellings"** on individual buildings (`https://watabou.github.io/dwellings/` — this replaced the Procgen Mansion link from 0.9.2).

---

## 8. Full MFCG devlog index (for completeness)

Closed-source era (0.8+) covered above. Earlier open-source-era devlogs on the same itch blog, oldest→newest: `1206/the-first-post`, `1367/tiny-fixes-and-preview-of-hatching`, `1579/some-answers-and-comments`, `2062/022-temples-wards-overview`, `3091/030-wall-less-layouts-city-outskirts-smooth-roads`, `4923/040-coastal-cities`, `6271/041-options`, `6592/source-code`, `7063/042-shanty-towns-and-more-options`, `8154/043-export`, `9958/some-progress-on-3d-view`, `11802/050-rivers-and-basic-house-shapes`, `15006/toy-town`, `19034/051-and-merry-christmas`, `22717/future-plans-for-mfcg`, `22794/052-warp-tool`, `31287/experimenting`, `34104/053-neighbourhoods-alleys-and-buildings`, `46967/054-integration-with-azgarrs-fantasy-map-generator`, `59798/055-farm-fields-rotation-tool-and-city-names`, `67134/060-custom-colors-scale-bar-elevation`, `85275/070-districts`, `91172/071-editable-district-names`, `101529/072-lots-of-mostly-small-mostly-visual-changes`, `112574/073-bug-fixes-geojson-export`, `123268/city-viewer-aka-toy-town-2`, `124980/city-viewer-101-gable-roofs-and-obj-export`, `153064/076-landmarks`. Several of these (`042-shanty-towns-and-more-options`, `073-bug-fixes-geojson-export`, `070-districts`, `076-landmarks`) are likely worth a follow-up pass if you need the original ward-type and GeoJSON-schema rationale.

agentId: ab020f86b1102aa7e (use SendMessage with to: 'ab020f86b1102aa7e', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 250875
tool_uses: 101
duration_ms: 1227376</usage>

---

<!-- fuente: city-medieval-layout.md -->

Research complete across all four areas. I verified the key source claims directly against local checkouts (`Cutter.hx`, `polygon_util.ts`) and extracted the CGA Shape grammar from the 28 MB PDF via `pdftotext`.

---

# Procedural Medieval City Layout — Technical Report

## 0. The thesis: where Watabou is beatable

I reverse-engineered MFCG's open-source ancestor line by line. Its weaknesses are structural, not cosmetic:

| # | Watabou's actual behaviour (from source) | Why it's wrong | Fix |
|---|---|---|---|
| 1 | Lots = recursive bisection of a Voronoi cell (`Ward.createAlleys`) | Lots have **no consistent relationship to the street**. Real medieval plots are strips *perpendicular* to a frontage with near-constant width | Vanegas straight-skeleton **strip** subdivision (§A3) + burgage params (§B1) |
| 2 | Streets **are** Voronoi cell edges (`Topology.hx`) | No street can cross a ward; no through-routes; hierarchy is 3 hardcoded widths | Separate street graph from cell graph; tensor-field or L-system majors (§A1/A2) |
| 3 | Ward mix = fixed 36-card deck, only 3 adjacent swaps | Near-deterministic district mix; **everything past 36 patches becomes `Slum`** | Rule grammar over tagged districts |
| 4 | `Graph.aStar` is Dijkstra with FIFO `openSet.shift()` | No heuristic, no priority queue | Real A* |
| 5 | Any failure → **regenerate the entire city** (`throw` + retry loop) | Rejection sampling on "Bad citadel shape!", "Unable to build a street!" | Local repair |
| 6 | All footprints are convex products of straight cuts | **No L-shapes, no courtyards, no cruciform churches** | §D |
| 7 | No burgage plots, back lanes, plot series, market infill, fringe belts, faubourgs, or growth history | Every city is one age | §B + §E |

Everything below is what you need to do it properly.

---

## PART A — ACADEMIC / CLASSIC ALGORITHMS

### A1. Parish & Müller, *Procedural Modeling of Cities* (SIGGRAPH 2001)
PDF: https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf

**The extended L-system (verbatim productions).** Modules: `R(del, ruleAttr)` road, `?I(roadAttr, state)` insertion query, `B(del, ruleAttr, roadAttr)` branch delay. `state ∈ {UNASSIGNED, SUCCEED, FAILED}`.

```
ω:  R(0, initialRuleAttr) ?I(initRoadAttr, UNASSIGNED)

p1: R(del, ruleAttr) : del<0 → ε
p2: R(del,ruleAttr) > ?I(roadAttr,state) : state==SUCCEED
    {globalGoals(ruleAttr,roadAttr) creates pDel[0-2], pRuleAttr[0-2], pRoadAttr[0-2]}
    → +(roadAttr.angle) F(roadAttr.length)
      B(pDel[1],pRuleAttr[1],pRoadAttr[1]),
      B(pDel[2],pRuleAttr[2],pRoadAttr[2]),
      R(pDel[0],pRuleAttr[0]) ?I(pRoadAttr[0],UNASSIGNED)
p3: R(del,ruleAttr) > ?I(roadAttr,state) : state==FAILED → ε
p4: B(del,ruleAttr,roadAttr) : del>0  → B(del-1, ruleAttr, roadAttr)
p5: B(del,ruleAttr,roadAttr) : del==0 → [R(del,ruleAttr) ?I(roadAttr,UNASSIGNED)]
p6: B(del,ruleAttr,roadAttr) : del<0  → ε
p7: R(del,ruleAttr) < ?I(roadAttr,state) : del<0 → ε
p8: ?I(roadAttr,state) : state==UNASSIGNED
    {localConstraints(roadAttr) adjusts state, roadAttr} → ?I(roadAttr,state)
p9: ?I(roadAttr,state) : state!=UNASSIGNED → ε
```

**The "ideal successor" mechanism** — the actual contribution. Per cycle: (1) L-system returns a generic template with *unassigned* parameters (the ideal successor); (2) `globalGoals()` fills in parameter values from dominant global goals; (3) `localConstraints()` checks/adjusts them against the environment. `del` acts as a brake — `globalGoals` can set it negative and p1 deletes the branch next iteration.

**globalGoals — population steering (highways):** "Every highway road-end shoots a number of rays radially within a preset radius. Along this ray, samples of the population density are taken… weighted with the inverse distance to the roadend and summed up. The direction with the largest sum is chosen."

```
direction = argmax_ray Σ_{p ∈ ray} density(p) / dist(p, roadEnd)
```
Streets do *not* follow the density gradient — they follow the dominant pattern rule, but each street end **lowers** local population density (within roughly the block area).

**Pattern rules:** *Basic* (density gradient only) · *New York* (fixed global/local angle + max block length & width) · *Paris/radial* (highways follow radial tracks about a computed or manual centre) · *San Francisco* (routes of least elevation; cross-slope connectors follow steepest gradient and are short). Multi-pattern blending: "all of them are evaluated. The proposed parameter values are summed up and weighted according to the value in the input image grey scale map."

**localConstraints — two steps:**
1. Does the segment end inside/cross an illegal area (water, park)? Repairs, in order: **prune** length up to a factor so it fits the legal area; **rotate** within a max angle until fully legal (this is what makes roads follow coastlines and park boundaries); highways may cross illegal area up to a specified length.
2. Intersection/snap: check all nearby segments for intersection → prune + create crossing; if the end is near an existing crossing → extend to reach it; if near an intersecting segment → extend to form the intersection.

**Lot subdivision:** "A block is divided into smaller units using a simple, recursive algorithm that divides the longest edges that are approximately parallel until the subdivided lots are under a threshold area." Then **all allotments too small or without direct street access are discarded**. Roads smoothed with Catmull-Clark. Perf: Manhattan ~13,000 buildings, street graph <10 s, lots+buildings ~10 min.

**Critical gap:** the paper specifies *no* numeric values (ray radius, snap distance, rotation limit). Take them from the working implementations below.

**Working constants — phiresky/procedural-cities** (AGPL, TS, `implementation/src/config.ts`), a faithful P&M reimplementation with a 15-page write-up: https://github.com/phiresky/procedural-cities
```
DEFAULT_SEGMENT_LENGTH 300      HIGHWAY_SEGMENT_LENGTH 400
DEFAULT_SEGMENT_WIDTH  6        HIGHWAY_SEGMENT_WIDTH  16
RANDOM_BRANCH_ANGLE   = randomNearCubic(3)   // ±3°,  cubic-biased toward 0
RANDOM_STRAIGHT_ANGLE = randomNearCubic(15)  // ±15°
DEFAULT_BRANCH_PROBABILITY 0.4  HIGHWAY_BRANCH_PROBABILITY 0.02
HIGHWAY_BRANCH_POPULATION_THRESHOLD 0.1   NORMAL_BRANCH_POPULATION_THRESHOLD 0.1
NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY 10  HIGHWAY_POPULATION_SAMPLE_SIZE 1
MINIMUM_INTERSECTION_DEVIATION 30°   SEGMENT_COUNT_LIMIT 7000   ROAD_SNAP_DISTANCE 50
QUADTREE_MAX_OBJECTS 10  QUADTREE_MAX_LEVELS 10  HEATMAP_PIXEL_DIM 25
```
**t-mw/citygen-godot** (MIT — usable) diverges meaningfully: https://github.com/t-mw/citygen-godot, write-up http://tmwhere.com/city_generation.html
```
segment_count_limit 2000   BRANCH_ANGLE_DEVIATION 3.0°   STRAIGHT_ANGLE_DEVIATION 15.0°
MINIMUM_INTERSECTION_DEVIATION 30.0°   HIGHWAY_BRANCH_PROBABILITY 0.05
NORMAL/HIGHWAY_BRANCH_POPULATION_THRESHOLD 0.5   NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY 5
MAX_SNAP_DISTANCE 50   BUILDING_SEGMENT_PERIOD 5   BUILDING_COUNT_PER_SEGMENT 10
MAX_BUILDING_DISTANCE_FROM_SEGMENT 400.0
```
Note the disagreement: highway branch prob 0.02 vs 0.05, pop threshold 0.1 vs 0.5, delay 10 vs 5. Treat these as a **tuning envelope**, not gospel.

### A2. Chen et al., *Interactive Procedural Street Modeling* (SIGGRAPH 2008)
PDF: https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf · project: https://www.sci.utah.edu/~chengu/street_sig08/street_project.htm

**Tensor representation.** 2×2 symmetric traceless tensor encoded as `(R, θ)`, `R ≥ 0`, `θ ∈ [0,2π)`:
```
T = R · [ cos2θ   sin2θ ]
        [ sin2θ  -cos2θ ]
```
Major eigenvectors `λ(cosθ, sinθ)ᵀ`; minor `λ(cos(θ+π/2), sin(θ+π/2))ᵀ`. Perpendicular everywhere except at **degenerate points** where `T(p)=0`.

**Design elements:**
- *Grid/regular*, direction `(uₓ,uᵧ)` at `p₀`: `l=√(uₓ²+uᵧ²)`, `θ=atan(uᵧ/uₓ)`, `T = l·[cos2θ, sin2θ; sin2θ, −cos2θ]`
- *Radial* about `p₀`, with `x = xₚ−x₀`, `y = yₚ−y₀`:
  ```
  T(p) = [  y²−x²    −2xy  ]
         [  −2xy   −(y²−x²)]
  ```
- *Height field* `H`: `θ = atan((∂H/∂y)/(∂H/∂x)) + π/2`, `R = |∇H|`. Minor eigenvector aligns with the gradient.
- *Boundary/coastline*: extract polyline, place a regular element at each `A` with major eigenvector `AB`, blend.

**Blending:** `T(p) = Σᵢ e^(−d‖p−pᵢ‖²) · Tᵢ(p)`, `d` = user decay constant. Smoothing via discrete Laplacian `T(vᵢ) = Σ_{j∈Jᵢ} ωᵢⱼ T(vⱼ)`, `ωᵢⱼ = 1/Nᵢ`, solved by conjugate gradient.

**Rotation fields** `R₁,R₂,R₃ ∈ [−π/2, π/2]`: `R₁` rotates major and minor in *opposite* directions (this is what breaks perpendicularity and gives organic form); `R₂`/`R₃` rotate one family only. Perlin noise into `[−π/2,π/2]` gives organic street curvature.

**Streamline tracing:** adaptive Runge-Kutta (Cash-Karp 1990), bilinear interpolation on a **512×512** grid. Sign disambiguation: choose `Ev` with `Ev · V_pre ≤ 0`. Interleaved major/minor seeding: trace major → place a new seed at distance `d_sep` → trace minor from it → repeat. Stop on: domain boundary, degenerate point, loop closure, max length, or violating `d_sep`. After stopping, continue `d_lookahead` further to find an intersection (this is what closes blocks instead of leaving dead ends).

Seed priority: `ω_ps = e^(−d_b) + e^(−d_s) + e^(−d_p)` where `d_b` = distance to nearest water boundary, `d_s` = to nearest degenerate point, `d_p` = to nearest population centre.

Major graph `G_M` first; then `G_M` edges + topography partition the domain into regions, each with its own (discontinuous across majors) tensor field, traced independently for minors `G_m`. Blocks = faces of the planar graph formed by intersecting major and minor streamlines.

**The real gift — ProbableTrain's tuned constants.** https://github.com/probabletrain/mapgenerator (GPL-3.0/LGPL-3.0, TS), live at https://maps.probabletrain.com. `src/ts/ui/main_gui.ts`:
```
minor  roads: dsep 20,  dtest 15,  dstep 1, dlookahead 40,  dcirclejoin 5, joinangle 0.1
              pathIterations 1000, seedTries 300, simplifyTolerance 0.5, collideEarly 0
major  roads: dsep 100, dtest 30,  dlookahead 200
main   roads: dsep 400, dtest 200, dlookahead 500
coastline:    minor params + pathIterations 10000, simplifyTolerance 10,
              coastNoise{size 30, angle 20}, riverNoise{size 30, angle 20}, riverSize 30
buildings:    maxLength 20, minArea 50, shrinkSpacing 4, chanceNoDivide 0.05
```
Derived in the `StreamlineGenerator` ctor: `dtest = min(dtest, dsep)`, `dcollideselfSq = (dcirclejoin/2)²`, `nStreamlineStep = floor(dcirclejoin/dstep)`, `nStreamlineLookBack = 2·nStreamlineStep`, `NEAR_EDGE = 3`. Note the clean **1 : 5 : 20** `dsep` hierarchy (20/100/400) — that's your three-tier street ladder.

Go port with RK4 and a flatbush spatial index (Apache-2.0, so **copyable**): https://github.com/Flokey82/go_gens — `gencitymap/{tensor,tensor_field,tensor_integrator,tensor_streams,tensor_graph,tensor_polygon_finder}.go`. Integrator: `(k1 + 4·k23 + k4)·dstep/6`.

### A3. Vanegas et al., *Procedural Generation of Parcels in Urban Modeling* (EG 2012) — **the most important paper here**
PDF: https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf · DOI https://doi.org/10.1111/j.1467-8659.2012.03047.x

**Algorithm 2 — OBB recursive subdivision (verbatim):**
```
subdivOBB(B)
  L ← ∅ ; recSubdivOBB(C(B))

recSubdivOBB(l)
  if area(l) ∉ (Amin,Amax) and frontSideWidth(l) ∉ (Wmin,Wmax) then
      s ← computeSplitLine(l)
      [lA,lB] ← split(B,s)
      if lA or lB have no street access then
          Rotate s 90° about normal of plane containing B, with probability ξ
          [lA,lB] ← split(B,s)
      end if
      recSubdivOBB(lA) ; recSubdivOBB(lB)
  else
      Append l to L
  end if

computeSplitLine(l)
  OBB ← computeOBB(l)
  direction of l = direction of shortest OBB side
  pivot = middle point of OBB
  apply random translation of magnitude ω·d_OBB to pivot
```

**Algorithm 1 — straight-skeleton subdivision (verbatim). This is the burgage-plot algorithm:**
```
subdivSkeleton(B)
  L ← ∅
  SS ← computeSkeletonOffset(C(B), d_offset)
  LS ← ∅
  for each face f ∈ SS do  Append convertToStrip(f) to LS  end
  LS2 ← mergeOnLogicalStreets(LS)
  LS3 ← fixDiagonalEdges(LS2)
  for each strip s in LS3 do  slice(s)  end
  processSmallLargeOrTriangularLots(LS, Amin, Amax)
```
Stages: (1) offset the block contour inward by `d_offset` via partial skeleton application; (2) each skeleton face becomes an **α-strip**; (3) merge adjacent faces belonging to the same *logical street*; (4) remove diagonal edges by reassigning regions → **β-strips**; (5) slice each strip with rays **perpendicular to its supporting edge**. Ray positions are "sampled approximately equidistantly on ψ(sᵢ), normally distributed around `(Wmin+Wmax)/2`, with `σ² = 3ω`."

**Parameters:**

| Symbol | Range | Meaning |
|---|---|---|
| `Amin`, `Amax` | user | parcel area bounds |
| `Wmin`, `Wmax` | user | parcel width (OBB side) bounds — **this is street frontage** |
| `ω` | [0,1] | split irregularity (deviation from midpoint) |
| `d_offset` | user | **parcel depth from street** |
| `ξ` | [0,1] | street-access preference. `ξ=1` ⇒ access always guaranteed; `ξ=0` ⇒ landlocked parcels frequent |
| `T(vᵢ)` | {Previous, Next, None} | diagonal-edge resolution |

**Auto-fitting from GIS data:** `Amin = Ā − k·s_A`, `Amax = Ā + k·s_A`, `Wmin = W̄ − k·s_W`, `Wmax = W̄ + k·s_W`, with **k = 2**.

**No street access:** in the skeleton method, sufficiently small `d_offset` leaves an **interior region** with no access — that is your medieval **backland / courtyard / back lane**, and it "can be further partitioned using an arbitrary subdivision style." Post-process: "Triangular parcels and parcels with small areas are repeatedly unioned with neighbors until either larger than minimum area, neither small nor triangular, or only one remaining parcel."

> **Why this is the headline finding:** `subdivSkeleton` with `d_offset` = plot depth and `(Wmin,Wmax)` = plot frontage **is literally a burgage-plot generator**. The α/β-strip is Conzen's "plot series." The leftover interior is the backland. Watabou has no equivalent. This one substitution is the single biggest realism win available.

### A4. Straight skeleton & polygon offsetting
CGAL docs: https://doc.cgal.org/latest/Straight_skeleton_2/index.html

Skeleton = paths traced by polygon vertices moving along angular bisectors under a shrinking wavefront. Two event types: **edge events** (a moving vertex collides with an offset edge) and **split events** (two vertices impact each other, splitting the region — this is what handles reflex vertices, i.e. L-shaped and U-shaped footprints).

API: `create_interior_straight_skeleton_2()`, `create_exterior_straight_skeleton_2()`, `create_offset_polygons_2()`, `create_interior_skeleton_and_offset_polygons_2()`, `create_exterior_skeleton_and_offset_polygons_2()`, plus `arrange_offset_polygons_2()` (rebuilds parent/hole nesting) and `compute_outer_frame_margin()`. Weighted variants exist (`_weighted_`).

**Outward offsetting trick** (needed for walls, moats, ditch bands): put the polygon as a **hole inside a large rectangular frame**, compute the interior skeleton, extract contours, discard the frame's own offset. "If the frame is sufficiently separated from the contour, the resulting skeleton will be equivalent to a *real* exterior skeleton."

Practical notes: use `Exact_predicates_inexact_constructions_kernel`; collinear edges are allowed; **computing the skeleton is much slower than generating offsets from it — compute once, extract many offsets** (exactly what you want for burgage depth series). Offset polygons may have more, fewer, or equal sides, and may split into multiple components.

Java implementation, **Apache-2.0 (copyable)**: https://github.com/twak/campskeleton — weighted straight skeleton, **supports negative weights for offsetting in either direction**, Felkel's algorithm with robustness fixes, available via JitPack.

---

## PART B — MEDIEVAL URBAN MORPHOLOGY (the realism numbers)

### B1. Burgage plots — the atomic land unit

**Master module: 1 perch/rod/pole = 16.5 ft = 5.0292 m.** 1 acre = 160 sq perches = 4046.9 m². Quantise every plot dimension to perches. (https://www.burgageplots.info/a-planned-approach)

| Town | Frontage × Depth (original) | Metric | Area | W:D |
|---|---|---|---|---|
| Salisbury (1225 grant) | 3 × 7 perches | 15.09 × 35.20 m | 531 m² | 1:2.33 |
| Stratford-upon-Avon (1196) | 3½ × 12 perches | 17.60 × 60.35 m | 1,062 m² | 1:3.43 |
| Charmouth (1320) | 4 × 20 perches (½ acre) | 20.12 × 100.58 m | 2,023 m² | 1:5 |
| Hungerford | 2 × 20 rods (¼ acre) | 10.06 × 100.58 m | 1,012 m² | **1:10** |
| Tewkesbury (11th C) | 4 × 40 perches (1 acre) | 20.12 × 201.17 m | 4,047 m² | 1:10 |
| Ludlow, Corve St E | depth exactly 18 perches | 90.5 m deep | — | ~1:11 |
| Alnwick (Conzen) | modal 28 ft | **8.53 m** | — | — |
| Hildesheim Dammstadt | ideal 6 × 12 Ruten | 28 × 56 m | 1,568 m² | 1:2 |
| Bastide *ayral* | avg | **8 × 24 m** | 192 m² | 1:3 |
| Gdańsk tenements | — | **5–7 m** frontage | — | — |
| Wrocław Ring | 60 ft each, 36 round the square | 18.78 m | — | — |

Sources: [VCH Wilts vi](https://www.british-history.ac.uk/vch/wilts/vol6/pp69-72) · [VCH Warks iii](https://www.british-history.ac.uk/vch/warks/vol3/pp247-258) · [burgageplots.info](https://www.burgageplots.info/a-planned-approach) · [Hungerford VM](https://www.hungerfordvirtualmuseum.co.uk/index.php/10-themes/954-burgage-plots) · [Haslam, Bridgnorth & Ludlow](https://jeremyhaslam.wordpress.com/wp-content/uploads/2009/12/bridgnorth-and-ludlow-town-plans.pdf) · [Alnwick Civic Society](https://alnwickcivicsociety.org.uk/2020/09/11/rods-poles-and-perches/) · [Academia: Hildesheim](https://www.academia.edu/6125759/12_Ruten_lang_6_Ruten_breit_%C3%9Cberlegungen_zur_Grundst%C3%BCcksaufteilung_in_der_Dammstadt_von_Hildesheim) · [fr.wikipedia Bastide](https://fr.wikipedia.org/wiki/Bastide_(ville)) · [Buildings 11(3):80](https://www.mdpi.com/2075-5309/11/3/80) · [Market Square, Wrocław](https://en.wikipedia.org/wiki/Market_Square,_Wroc%C5%82aw)

**Frontage distribution.** Common English burgage frontage **28–32 ft = 8.53–9.75 m**; full legal range 2–8 perches = 10.06–40.23 m. Scottish metrological analysis of **49 street blocks** across Edinburgh/Canongate/St Andrews/Perth gives modal unit widths **5.76–12.80 m, clustering 8–9 m**, with statistical margin ±0.15 m (68% CI). Critically, all burghs conform to a **quarter-plot scheme** — plots vary in **quarter-unit increments** of a local modal width; ~⅔ of measured plots fall within ±0.5 m of an exact quarter-width, spanning **0.75 to 2.5 units**. ([PSAS Tait](https://journals.socantscot.org/index.php/psas/article/download/9724/9691/9675), [Urban History](https://www.cambridge.org/core/journals/urban-history/article/framework-and-form-burgage-plots-street-lines-and-domestic-architecture-in-early-urban-scotland/4FC18665945BC7A9144C4C9165838A5A))

**Why 8–10 m:** it's the max practical span of a single oak beam. A typical medieval room spans ~15 ft (4.6 m), so a 28-ft plot = two rooms wide, or one room + a side passage.

**Depth:frontage bands for a generator:**
- **1:2 – 1:3.5** — dense planned cores (Salisbury, Stratford, Hildesheim, bastides)
- **1:5 – 1:6** — the common English default (Charmouth, Hexham)
- **1:10 – 1:11** — long tails running to a back lane / open field (Hungerford, Tewkesbury, Ludlow)

Absolute depth ladder: **35 → 60 → 90 → 100 → 201 m**.

**Legal subdivisions** of a 1-acre plot, in poles: `10×16, 20×8, 32×5, 40×4, 80×2`. Documented fractions: whole burgage, half, quarter, "half a quarter."

**Conzen's apparatus** (*Alnwick, Northumberland: A Study in Town-Plan Analysis*, IBG Pub. 27, 1960 — [record](https://www.researchgate.net/publication/240739085_Conzen_MRG_1960_Alnwick_Northumberland_A_study_in_town-plan_analysis_Institute_of_British_Geographers_Publication_27_London_George_Philip), summary [EPUM BP1](https://www.surf.com.cy/wp-content/uploads/2023/03/EPUM_BP1_Historical-Geographical.pdf)):
- **Burgage cycle**, 3 phases: (1) progressive **filling-in** of the backland toward a *climax phase*; (2) **clearing** (recession); (3) **urban fallow**. Alnwick worked example: Teasdale's Yard, Fenkle Street, **1774–1956 ≈ 180-year cycle**. Morphometric restatement uses front width, plot area, and **Building Coverage Ratio (BCR)** ([Springer](https://link.springer.com/chapter/10.1007/978-3-030-87016-4_35)).
- **Plot series** — "a row of adjacent plots that share similar building line and development characteristics." **Emit plots in series, never independently.**
- **Plot head** (frontage + the *plot dominant*, i.e. main building, on the street line) vs **plot tail** (larger rear part, rarely occupied by the dominant).
- **Truncation → tail-end plot**: the back lane gets built on, spawning derivative plots facing it.
- **Plot amalgamation**: merging when societal requirements diverge from the original layout.
- **Fringe belt** — belt-like zone at a slowly-advancing town fringe: cemeteries, fortifications, palaces, gardens, parks, museums, prisons, recreation grounds, religious institutions. Low density, large open parcels. Three tiers: **Inner (IFB)** pinned to the town wall as a *fixation line*, **Middle**, **Outer**. Alnwick has all three. ([Łódź fringe-belt paper](https://czasopisma.uni.lodz.pl/fgsoe/article/download/1205/874/0))

**Back lanes** ("occupation road" in Conzen): route parallel to and opposite the main thoroughfare, bounding the far ends of the plot series, producing a **rectangular frame**; frequently the boundary between built village and open fields. Hungerford's sit 110 yd (100.6 m) behind the High Street; Ludlow's at 18 perches (90.5 m). Width analogue 16–24 ft (4.9–7.3 m); bastide *venelle/carreyrou* 1–3 m. ([Back lane](https://en.wikipedia.org/wiki/Back_lane))

### B2. Street widths, market squares, block sizes

| Class | Width | Case |
|---|---|---|
| Grand market street | **~23 m** original, encroached to 19 m | Edinburgh High Street |
| Major street | ~15 m original, encroached to 11 m | Canongate |
| Bastide *charretière* (main cart street) | **6–10 m** | Eymet 7 m, Miramont 10 m |
| Bastide transverse | 5–6 m (Monpazier **2.5 m**) | |
| Generic medieval main road | 12–15 ft = **3.7–4.6 m** | |
| Generic secondary road | 8–10 ft = **2.4–3.0 m** | |
| *Venelle / carreyrou* | **1–3 m** | rear access |
| *Androne* (firebreak slot) | **0.25–0.40 m** | between houses |

**Encroachment is a first-class process.** Measured frontage extensions in Edinburgh & Canongate (13 sites): **1.6–2.9 m**, mean **2.2 m**; standard 15th-C English jetty projection **0.52–0.60 m per storey**. Streets narrow over time — model this, Watabou doesn't. ([Urban History](https://www.cambridge.org/core/journals/urban-history/article/framework-and-form-burgage-plots-street-lines-and-domestic-architecture-in-early-urban-scotland/4FC18665945BC7A9144C4C9165838A5A), [Esprit de Pays](https://espritdepays.com/patrimoines-en-perigord/patrimoine-bati-du-perigord/les-bastides-du-perigord/cadre-urbain-des-bastides), [Designing Buildings](https://www.designingbuildings.co.uk/wiki/The%20history%20of%20the%20dimensions%20and%20design%20of%20roads,%20streets%20and%20carriageways))

**Market squares:**

| Place | Dimensions | Area | Streets entering |
|---|---|---|---|
| Kraków, Rynek Główny (1257) | — | **3.79 ha** | **3 evenly spaced per side, at right angles** (12) |
| Wrocław, Rynek (1214–32) | **213 × 178 m** (orig. 600 × 480 ft) | 3.79 ha | **11**: two at each corner + 2 lanes |
| Toruń, New Town (1264) | **95 × 95 m** | 0.90 ha | **8**: perpendicular pairs at each corner |
| Bastide central squares | **40×40 to 70×70 m** | 0.16–0.49 ha | corner entry under arcades (*cornières*) |
| Marciac (largest bastide) | 75 × 130 m | 0.98 ha | |
| Northampton | 146 × 207 m | ~3.0 ha | |

**Market infill is systematic** — temporary stalls petrify into permanent building islands. Salisbury's surviving rows **Oatmeal Row, Butcher Row, Fish Row** are fossilised stall lines. Toruń's meat tables occupied a strip **4.6 m wide running the whole block length**. English default market form is a **funnel/tapering street-market**: "most market streets taper at either end." Markets also **relocate** (Northampton: charter 1189, moved 1235, replanned 1300). ([VCH Salisbury market place](https://www.british-history.ac.uk/vch/wilts/vol6/pp85-87), [Toruń](https://en.wikipedia.org/wiki/New_Town_Market_Square,_Toru%C5%84), [Northants HER](https://her.northamptonshire.gov.uk/Monument/MNN13703), [Long Buckby](https://her.northamptonshire.gov.uk/Monument/MNN103184))

**Bastide grid geometry.** Monpazier (1284): overall **400 × 220 m** (8.8 ha), streets parallel to the long sides, **4 transversal streets**, **6 original gates**. Gimont: 1,000 × 300 m (30 ha). Full settler grant: *ayral* (house plot) 8 × 24 m + *cazal* (garden) **500–700 m²**, kept in a **2:3 proportion** to the house plot, + *arpent* (arable) **5–6 ha**. Derived block short axis ≈ **50–70 m** (two 24 m ayrals back to back + service lane). ([French Moments](https://frenchmoments.eu/monpazier-dordogne/), [Cornell Bastides](https://exhibits.library.cornell.edu/bastides-collection/feature/monpazier), [fr.wikipedia](https://fr.wikipedia.org/wiki/Bastide_(ville)))

**New Winchelsea (1288)** — the best-documented planned town: **4,000 × 1,800 ft = 1,219 × 550 m**, 151 acres = **61.2 ha**, **802 plots in 1292** held by 690 persons ⇒ **13 plots/ha gross** (~770 m² of land per plot including streets). Vaulted cellars commonly **30 × 15 ft = 9.1 × 4.6 m** — a good frontage-building footprint proxy. Per-town data for all 13 Edward I new towns at [ADS atlas](https://archaeologydataservice.ac.uk/archives/view/atlas_ahrb_2005/atlas.cfm) (scrape `atlas.cfm?town=<name>`).

### B3. Walls, gates, suburbs

| Town | Circuit | Area | Gates | Towers | Gate spacing | Tower spacing | Ditch |
|---|---|---|---|---|---|---|---|
| Ávila | 2,516 m | 31 ha | 9 | 88 | **280 m** | **28.6 m** | — |
| Norwich | 4.0 km | — | 12 | ~40 | 333 m | 100 m | **6.1 m deep × 18 m wide** |
| York | 3.40 km | — | 4 bars + ~8 posterns | 39 | 850 m / ~283 m | 87 m | — |
| Southampton | 2.0 km | — | 8 | 29 | 250 m | 69 m | — |
| Nuremberg (c.1400) | 5.0 km | — | 4 gate towers | ~130 hist. | 714 m | ~38 m | dry moat avg **12 m deep, up to 20 m wide**, *Zwinger* ~15 m |
| Paris (Philip Augustus) | — | — | 6 per bank | every 200 ft | — | **61 m** | — |

**Generator rules:** tower spacing **28–100 m, default 30–60 m** (bowshot flanking geometry); gate spacing **250–350 m** dense, **700–850 m** for the English 4-bar pattern; wall thickness ~1 m English, 1.8–3.0 m continental; reserve a **35–50 m clear band** outside the wall for ditch + apron. Typical enclosed area **50–200 acres = 20–81 ha**. ([Ávila](https://en.wikipedia.org/wiki/Walls_of_%C3%81vila), [Norwich](https://en.wikipedia.org/wiki/Norwich_city_walls), [York](https://en.wikipedia.org/wiki/York_city_walls), [Southampton](https://en.wikipedia.org/wiki/Southampton_town_walls), [Nuremberg](https://en.wikipedia.org/wiki/City_walls_of_Nuremberg), [Encyclopedia.com](https://www.encyclopedia.com/history/news-wires-white-papers-and-books/urban-fortifications-and-public-places))

**Suburbs:** Bristol c.1300 — inner walled area **55 ha**, total settled incl. suburbs **130 ha** ⇒ **extramural:intramural ≈ 1.36:1, suburbs are 58% of built-up area**. Growth is ribbon development along roads radiating from gates; extramural linear parishes form along arterials (St Sidwell, Exeter). ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678), [Oakford Archaeology](https://www.oakfordarch.co.uk/the-ancient-parish-of-st-sidwell-exeter/))

**Population–area scaling, 173 European cities c.1280–1320:** `ln(area) = α + β·ln(pop)`

| Region | β | 95% CI | n |
|---|---|---|---|
| All | **0.714** | 0.662–0.766 | 173 |
| England | 0.730 | 0.604–0.856 | 40 |
| France & Belgium | 0.790 | 0.665–0.914 | 63 |
| Germany | 0.754 | 0.616–0.891 | 40 |
| Northern Italy | 0.720 | 0.566–0.874 | 30 |

β < 1 ⇒ **bigger medieval cities are denser**. Use `area ≈ k·P^0.714`; density rises as `P^0.286`. Measured gradient (Leiden 1574 census): **75 inh/ha at periphery → ~200 inh/ha in the centre**. Reference populations: 13th-C German towns averaged 2,000–3,000, only ~50 German cities above 5,000; Paris ~30,000; London ~70–80,000. ([PLOS ONE PDF](https://journals.plos.org/plosone/article/file?type=printable&id=10.1371/journal.pone.0162678), [Leiden, *Ranking the towns*](https://www.universiteitleiden.nl/en/research/research-projects/archaeology/ranking-the-towns))

### B4. Landmark placement

- **Parish churches:** York had **~45 in 1300**, 39 by 1428 (vs 8 + minster at Domesday). Against a population of 10–15k ⇒ **1 parish church per ~250–350 inhabitants** (~1 per 60–90 households) — an order of magnitude denser than rural. ([Medieval parish churches of York](https://en.wikipedia.org/wiki/Medieval_parish_churches_of_York))
- **Cathedral is not a building — it's a walled sub-enclave with its own gates.** Salisbury Cathedral Close is **>80 acres (>32 ha)**, walled, with named gates (High Street Gate, St Ann's Gate). Budget **10–30% of intramural area** in a cathedral city, off-axis from the market. ([Salisbury Cathedral](https://www.salisburycathedral.org.uk/visit-what-see/largest-cathedral-close))
- **Castle:** sited at "a strategically favourable point in the city wall," giving the lord **an outer gate to the open fields** (independent of the citizenry) **and a separate inner gate facing the town**. Variants: integrated into the circuit (Nuremberg, Horn), grown into it by branching walls (Esslingen), projecting out of an otherwise circular circuit (Feuchtwangen), or elevated citadel (Erfurt Petersberg). ⇒ **castle tangent to the circuit, with exactly 2 gates**. Oxford motte ditch: 9 m wide (likely half original), 5.5–6 m deep; curtain up to 2.2 m. ([Urban castle](https://en.wikipedia.org/wiki/Urban_castle), [Oxoniensia](https://oxoniensia.org/volumes/2009/poore.pdf))
- **Noxious trades:** slaughterhouses, tanneries, dye works confined to river districts, "often downstream from the drinking supply." Regulations also governed oversailing upper floors, neighbour proximity, and cess-pit/well separation. Genoa capped towers at **80 ft (24.4 m)**. ([Popular Archaeology](https://popular-archaeology.com/article/inside-a-medieval-city-public-health-housing-and-everyday-regulations/))

### B5. Street-pattern typology — quantitative signatures

Boeing's global indicators (population-weighted means), from [Street Network Models and Indicators for Every Urban Area in the World](https://escholarship.org/content/qt5db3f718/qt5db3f718.pdf):

| Subregion | Avg node degree | Intersections/km² | Median segment (m) | Circuity | Orientation-order |
|---|---|---|---|---|---|
| Western Europe | 2.79 | 72.55 | **78.11** | 6.40% | **0.03** |
| Northern Europe | 2.47 | 97.23 | **65.94** | 6.50% | **0.02** |
| Southern Europe | 2.86 | 115.94 | **62.99** | 5.93% | **0.05** |
| Northern America | 2.87 | 53.23 | 99.95 | 6.71% | **0.32** |

US/Canadian cities have **~13× the orientation-order** of European ones and ~2× the share of four-way intersections; European streets are **42% more circuitous**. ([Boeing](https://geoffboeing.com/2019/09/urban-street-network-orientation/))

Universal statistics over 100 world cities ([Barthelemy 2024, arXiv:2409.08016](https://arxiv.org/pdf/2409.08016)): avg node degree **2.30–3.55, median 2.93**; dead-ends **2–39%, median 14%**; degree-4 **4–59%, median 18%**; avg edge length **64.5–537.5 m, median 118.6 m**; planarity ratio mean 0.88; intersection count scales as **pop^0.95**; **block area follows a power law ~A^−α**.

Organic vs orthogonal centrality signature, 72 pre-industrial Afro-Eurasian sites ([PMC8585513](https://pmc.ncbi.nlm.nih.gov/articles/PMC8585513/)):

| Metric | Orthogonal | Hybrid/organic |
|---|---|---|
| Betweenness vs area, β | −0.19 | −0.34 |
| Current-flow centrality vs area, β | −0.83 | −1.09 |
| **Gini of eigenvector centrality** | **0.47** | **0.71** |

Differences significant at p<0.01. **Read:** organic networks concentrate connectivity in a small spine (Gini 0.71) — a few high-centrality streets and a long tail of poorly-connected lanes. Grids spread it (0.47). **This is a directly testable acceptance metric for your generator.**

---

## PART C — EXISTING GENERATORS, REVERSE-ENGINEERED

### C1. Watabou — TownGeneratorOS (**GPL-3.0**; algorithms aren't copyrightable, reimplement)
https://github.com/watabou/TownGeneratorOS · live (closed, newer) https://watabou.github.io/city-generator/

**Pipeline** (`Model.build()`): `buildPatches() → optimizeJunctions() → buildWalls() → buildStreets() → createWards() → buildGeometry()`, wrapped in a retry loop that regenerates the whole city on any thrown error.

**Voronoi seeding** — *not* blue noise, *not* Poisson. A √-angle spiral (phyllotaxis-like), **8× oversampled**:
```haxe
var sa = Random.float() * 2 * Math.PI;
var points = [for (i in 0...nPatches * 8) {
    var a = sa + Math.sqrt(i) * 5;
    var r = (i == 0 ? 0 : 10 + i * (2 + Random.float()));
    new Point(Math.cos(a)*r, Math.sin(a)*r);
}];
```
`dθ/di = 5/(2√i)`, `r ≈ 2.5i`. Dense centre, coarse periphery, no collisions. **Relaxation is minimal**: 3 iterations over only `{points[0], points[1], points[2], points[nPatches]}` (the citadel candidate). Everything else keeps raw spiral geometry — that's why the plaza is well-shaped and the outer wards are irregular.

Flags `plazaNeeded`, `citadelNeeded`, `wallsNeeded` are each an independent **50%** coin flip. Sizes: Small Town 6–10, Large Town 10–15, Small City 15–24, Large City 24–40, Metropolis 40; default `nPatches = 15`. RNG is a Lehmer LCG (`g=48271`, `n=2147483647`); `normal()` = mean of 3 uniforms; `fuzzy(f) = (1−f)/2 + f·normal()`.

**Junction cleanup:** merge any two patch vertices closer than **8 world units**, mutating the shared `Point` object in place (vertices are shared references across patches — that's the trick keeping the mesh consistent).

**Curtain wall:** `shape = findCircumference(inner)` (directed edges with no reverse twin, chained into a ring), then `smoothVertex(v, f)` with `f = min(1, 40/nPatches)` and `smoothVertex(v,f) = (prev + v·f + next)/(2+f)`. Citadel vertices are `reserved` and never moved.

**Gates:** candidates are wall vertices that are not reserved **and shared by >1 inner patch** ("so that a street could connect it to the city center"). Then `do { pick random; splice(index−1, 3) } while (entrances.length >= 3)` ⇒ **gates ≥3 wall vertices apart; count ≈ ⌊|entrances|/3⌋**. Every non-gate wall vertex becomes a tower. If the single outer patch at a gate has >3 vertices it is split along `gate → farthest vertex in the outward normal direction` so a road can exit.

**Citadel:** rejected if `compactness = 4π·area/perimeter² < 0.75` (circle 1.00, square 0.79, triangle 0.60) → full city regeneration. Castle geometry: `shrinkEq(4)` then `createOrthoBuilding(block, √(block.square)·4, 0.6)`.

**Streets:** `Topology.hx` builds a graph whose **nodes are patch polygon vertices** and **edges are patch polygon edges**, weighted by Euclidean length. Wall and citadel vertices are `blocked` except at gates. Per gate: `buildPath(gate, nearest plaza corner, exclude=outer)` for the street; for border gates also `buildPath(pointNearest(gate.norm(1000)), gate, exclude=inner)` for the outbound road. `Graph.aStar` is **Dijkstra with `openSet.shift()`** — no heuristic, no priority queue. Then `tidyUpRoads()` re-chains segments into maximal `arteries`; each artery gets `smoothVertexEq(3)` i.e. `v'ᵢ = (vᵢ₋₁ + 3vᵢ + vᵢ₊₁)/5`, endpoints pinned; rendered with `Spline.curvature = 0.1`.

**Ward deck** — 36 entries consumed by `shift()`, shuffled by only `⌊36/10⌋ = 3` adjacent swaps: `Craftsmen ×21, Slum ×5, Merchant ×2, Patriciate ×2, Market ×2, Cathedral, Administration, Military, Park`. **Past 36 patches everything becomes `Slum`.** Because Haxe statics aren't inherited, `Reflect.field(cls,"rateLocation")` returns null for `CraftsmenWard/GateWard/Park/Farm/CommonWard` — **those get uniformly random patches**. Only these rate (lowest score wins):

| Ward | rateLocation |
|---|---|
| Merchant | `dist(plaza.center ?? center)` — hug centre |
| Slum | `−dist(plaza.center ?? center)` — maximise distance |
| Administration | `borders(plaza) ? 0 : dist(plaza.center)` |
| Cathedral | `borders(plaza) ? −1/square : dist(plaza.center)·square` |
| Market | `+∞` if adjacent to another Market; else `square/plaza.square` |
| Military | `0` if borders citadel; `1` if borders wall; else `+∞` |
| Patriciate | `Σ neighbours: −1 per Park, +1 per Slum` |

Countryside: `cityRadius = max|v|`; non-city patches become `Farm` iff `Random.bool(0.2) && compactness ≥ 0.7`.

**Street widths / block inset** (`Ward.hx`): `MAIN_STREET = 2.0`, `REGULAR_STREET = 1.0`, `ALLEY = 0.6`. Per-edge inset = half-width: wall-adjacent or artery or plaza-adjacent → 1.0; other inner → 0.5; outer → 0.3. Then `isConvex() ? shrink() : buffer()`.

**`Cutter.hx`** (verified verbatim against local checkout):
```haxe
bisect(poly, vertex, ratio=0.5, angle=0.0, gap=0.0):
  p1 = interpolate(vertex, poly.next(vertex), ratio)
  d = next − vertex;  (vx,vy) = rotate(d, angle)
  p2 = (p1.x − vy, p1.y + vx)           // perpendicular to the rotated edge
  return poly.cut(p1, p2, gap)

radial(poly, center=centroid, gap):  per edge → Polygon([center,v0,v1]), shrink([gap/2,0,gap/2])
semiRadial(poly, center=vertex nearest centroid, gap): as radial, skipping sectors touching center
ring(poly, thickness):
  per edge: n = edge.rotate90().norm(thickness); slice = {p1:v1+n, p2:v2+n, len:|edge|}
  slices.sort(by len ASC)               // "Short sides should be sliced first"
  p = poly; for each slice: halves = p.cut(...); p = halves[0]; if 2 halves push halves[1]
  return peel                            // core is DISCARDED
```

**`Ward.createAlleys`** — the whole building generator:
```haxe
createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb=0.04, split=true):
  1. v = start vertex of the LONGEST edge
  2. spread = 0.8*gridChaos;  ratio = (1−spread)/2 + Random.float()*spread
  3. angleSpread = (π/6)*gridChaos * (p.square < minSq*4 ? 0 : 1)   // small blocks stay rectangular
     b = (Random.float() − 0.5) * angleSpread
  4. halves = Cutter.bisect(p, v, ratio, b, split ? ALLEY(0.6) : 0.0)
  5. per half: if (half.square < minSq * 2^(4*sizeChaos*(rand−0.5)))
                   if (!Random.bool(emptyProb)) buildings.push(half)     // leaf
               else recurse(split = half.square > minSq / (rand*rand))
```
Leaf threshold is **stochastic**: at `sizeChaos=0.8`, effective min area spans `minSq·2^±1.6 ≈ ×0.33…×3.0`. Because `minSq/(U·U)` is usually huge, **most deep cuts are gapless** ⇒ terraced rows; only large blocks get real 0.6-unit alleys.

**Ward parameters** (`r ≡ Random.float()`, fresh draw each occurrence):

| Ward | minSq | gridChaos | sizeChaos | emptyProb |
|---|---|---|---|---|
| Craftsmen | `10 + 80r²` | `0.5 + 0.2r` | 0.6 | 0.04 |
| Merchant | `50 + 60r²` | `0.5 + 0.3r` | 0.7 | **0.15** |
| Patriciate | `80 + 30r²` | `0.5 + 0.3r` | 0.8 | **0.2** |
| Administration | `80 + 30r²` | `0.1 + 0.3r` | 0.3 | 0.04 |
| Slum | `10 + 30r²` | `0.6 + 0.4r` | 0.8 | 0.03 |
| Gate | `10 + 50r²` | `0.5 + 0.3r` | 0.7 | 0.04 |
| Military | `√(block.square)·(1+r)` | `0.1 + 0.3r` | 0.3 | **0.25** |

Cathedral: 40% `Cutter.ring(block, 2+4r)`, else `createOrthoBuilding(block, 50, 0.8)`. Park: `compactness ≥ 0.7 ? radial : semiRadial`. Market: `statue = Random.bool(0.6)`; object is a `rect(1+r, 1+r)` rotated to the longest edge, or a 16-gon `circle(1+r)`; positioned `interpolate(centroid, midpoint(longest edge), 0.2+0.4r)`.

`filterOutskirts()` thins fringe buildings: keep iff `Random.fuzzy(1) > minDist/p` where `p` is an inverse-distance barycentric blend of per-vertex `density` (1 at gates, `2·rand` if all patches at that vertex are in-city, else 0).

**What the closed-source MFCG adds** (string extraction of `mfcg.js`, 1.31 MB): tokens `BANK, BRIDGE, CANAL, CASTLE, COAST, COMPACT, DOCKS, PARK, PLAZA, RIVER, SHANTY, SPRAWL, TEMPLE, WALLS, TEMPLATE, GUIDE, MULTI, UNIQUE` plus error strings `"The rule stack for "`, `"No suitable edge to split"` ⇒ **the modern version is a rule/grammar stack over tagged districts, not a hardcoded ward array**. Ops: `Displace, Equalize, Liquify, Shrink, Warp, Relax, Bloat, Offset, Rotate`. Exports PNG/SVG/JSON/GeoJSON.

### C2. Azgaar Fantasy Map Generator (**MIT**) — has no city layout generator
https://github.com/Azgaar/Fantasy-Map-Generator

**Headline finding: FMG delegates the entire building/wall/road layout to Watabou by URL.** There is no `city-generator.js` at any tag. `modules/ui/editors.js` L318:
```js
if (population >= options.villageMaxPopulation || burg.citadel || burg.walls || burg.temple || burg.shanty)
    return createMfcgLink(burg);
return createVillageGeneratorLink(burg);
```
The population→size law (`createMfcgLink`, L328):
```js
sizeRaw = 2.13 * Math.pow((burgPopulation * populationRate) / urbanDensity, 0.385);
size    = minmax(Math.ceil(sizeRaw), 6, 100);   // === Watabou's nPatches
```
Query params passed: `{name, population, size, seed, river, coast, farms, citadel, urban_castle, hub, plaza, temple, walls, shantytown, gates:-1 [, sea]}`. `sea` is an atan2 bearing (0=south, 0.5=west, 1=north, 1.5=east).

Village link tags: `estuary / island,district / coast / confluence / river / pond`, then `highway | dead end | isolated`, `uncultivated | farmland`, `no orchards`, `no square`, `sparse | dense`; `width = pop>1500?1600 : pop>1000?1400 : pop>500?1000 : pop>200?800 : pop>100?600 : 400`, `height = width/2.2`.

Burg feature flags (`modules/burgs-and-states.js` L263):
```js
b.citadel = Number(b.capital || (pop>50 && P(0.75)) || (pop>15 && P(0.5)) || P(0.1));
b.plaza   = Number(pop>20 || (pop>10 && P(0.8)) || (pop>4 && P(0.7)) || P(0.6));
b.walls   = Number(b.capital || pop>30 || (pop>20 && P(0.75)) || (pop>10 && P(0.5)) || P(0.1));
b.shanty  = Number(pop>60 || (pop>40 && P(0.75)) || (pop>20 && b.walls && P(0.4)));
b.temple  = Number((religion && theocracy && P(0.5)) || pop>50 || (pop>35 && P(0.75)) || (pop>20 && P(0.5)));
```

> **Strategic implication:** accept the same query string and you drop straight into FMG's ecosystem — FMG users are the single largest downstream consumer of MFCG.

### C3. Watabou Village Generator — closed, but the contract is legible
https://watabou.itch.io/village-generator · the itch.io devlogs are **teasers only** (2 sentences + a paywalled Patreon link — verified across 7 devlog IDs).

| | MFCG | Village Generator |
|---|---|---|
| Size param | patch count 6–100 | **width/height in world units**, non-square canvas |
| Structure driver | Voronoi patches → wards | **declarative tag list** |
| Enclosure | curtain wall + towers + gates | **palisade** (1.6.0, May 2024), no towers |
| Green | Park ward | orchards, groves, thickets, fields, furrows |
| Roads | A* gate→plaza over patch graph | highway / dead end / isolated / crossroads / fork / driveways |

Tag vocabulary recovered from `Village.js`: `hamlet, village, town, city, district` · `estuary, island, coast, confluence, river, riverside, mouth, fork, pond, wetland, shore, valley, hill, forest, no_water` · `highway, dead end, isolated, crossroads, junction, driveways` · `farmland, uncultivated, fields, orchards, no orchards, grove, thicket` · `sparse, dense, square, no square, organic, plain, compact` · `smithy, tavern, inn, temple, wharf, roadhouse, special_shop, bridge, palisade` · and a `"grammar"` string confirming a rule-grammar naming/layout system.

**Key structural takeaway: the village generator is road-first and field-first** — the road graph and farm fields come first, buildings hang off road frontage. MFCG is cell-first. **The village approach is closer to real medieval morphology**, and it's the one to generalise upward.

### C4. Other generators worth stealing from

- **★ ProbableTrain/MapGenerator** (GPL-3.0/LGPL-3.0, TS) — https://github.com/probabletrain/mapgenerator. Best technical rival; Chen tensor fields. Files: `impl/{tensor,basis_field,tensor_field,integrator,streamlines,grid_storage,graph,polygon_finder,polygon_util,water_generator}.ts`. Face extraction `PolygonFinder.findPolygons()`: for every node with `adj.length ≥ 2`, walk clockwise until the loop closes; discard faces with **>20 vertices**; mark traversed directed edges so each face is found once; filter by `tensorField.onLand(avg) && !inParks(avg)`.
  Its lot subdivision (verified locally, `impl/polygon_util.ts` L80) has one thing Watabou lacks and **one real bug**:
  ```ts
  if (area < 0.5*minArea) return [];
  if (area / (perimeter*perimeter) < 0.04) return [];   // SHAPE INDEX — rejects slivers (1:4 rect limit)
  if (area < 2*minArea) return [p];
  const deviation = Math.random()*0.2 + 0.4;            // 0.4..0.6
  const averagePoint = longestSide[0].clone().add(longestSide[1]).multiplyScalar(deviation);
  ```
  **Bug:** `averagePoint = (A+B)·deviation` is not `lerp(A,B,deviation)`. It equals the midpoint only when `deviation = 0.5`; otherwise it scales the midpoint **from the world origin**, so the cut position depends on how far the block is from `(0,0)`. Use `A + (B−A)·deviation`. **Steal the shape-index rejection (`A/P² < 0.04`), not the deviation code.**
- **Flokey82/go_gens** (**Apache-2.0**, Go) — https://github.com/Flokey82/go_gens. `gencitymap/` is an explicit Go port of ProbableTrain with RK4 + flatbush. `genvillage/` is *not* layout — it's an economic solver (`BuildingType{Requires, Provides}` + `Solve()` closing supply loops fishery→worker→grain→flour→bread). Excellent source of **semantic building mixes** to drive district composition. Also `genarchitecture`, `gengeometry`, `genworldvoronoi`.
- **LAVS-TM/Map-Generation** (**MIT**, Python + scipy.spatial.Voronoi + shapely) — https://github.com/LAVS-TM/Map-Generation. Closest philosophical clone of Watabou:
  ```python
  nb_people_by_districts = 8 + (density // 5000);  nb_regions = 4 + (population // 5000)
  walls = MultiPolygon(regions).buffer(0.05, join_style=2)   # miter
  new_regions, streets = map.split_region(regions, 0.05)     # street width
  nb_houses = population // 40                                # 40 people per house
  city_elements, _ = map.split_region(city_elements, 0.015)   # alley width
  ```
  Seeds a **jittered square grid** (not a spiral), then keeps only regions inside a random `convex_hull(8 pts).buffer(radius/2)` blob — that blob is the irregular city silhouette. Buildings via a *second* Voronoi on a jittered lattice inside each district. Ward classes in `src/downtown/{market,cathedral,church,castle,house,university,mansion,garden,townhall,park,fort,monastry}.py`.
- Others (https://github.com/topics/city-generator): `fegennari/3DWorld` (C++, full 3D city engine), `jeroenvanriel/city-generator`, `dasmig/city-generator` (C++23, demographic-driven), `gabrielboroghina/Procedural-City-Generation`.

### C5. Sean Barrett — Herringbone Wang Tiles
https://nothings.org/gamedev/herringbone/ · papers [2011](https://nothings.org/gamedev/herringbone/herringbone_tiles.html), [2014](https://nothings.org/gamedev/herringbone/more_herringbone_tiles.html) · source https://github.com/nothings/stb/blob/master/stb_herringbone_wang_tile.h (**public domain / MIT**)

Tiles are 1:2 and 2:1 rectangles laid in a herringbone parquet. Each rectangle is two squares; splitting the long edges gives every tile **6 edges** ⇒ herringbone tiling is **isomorphic to hexagonal tiling** ("each rectangle can be seen as a hexagon whose corners are flexed"), with **6 distinct edge-matchup classes** (vs 2 for square Wang tiles, 3 for hex).

Tile counts: Cohen-style (3 constrained edges, 2 colours) needs **16 horizontal + 16 vertical**; a **complete stochastic set** (one tile per combination of all six edge colours) needs **64 + 64 = 128**. The complete set is the actual contribution: a tile choice can never constrain anything beyond its immediate neighbours, so you can **pre-place large/unique tiles first** and still fill deterministically, and never dead-end.

Layout loop (`stbhw_generate_image`, L692): 4-row herringbone period `phase = j & 3`, row displacement `i = (phase==0) ? 0 : phase−4`, stride 4 short-sides; corner colour class `p = (i − j + 1) & 3`. Selection (`stbhw__choose_tile`) is a two-pass weighted reservoir over the 6 partial constraints (`*a < 0` = wildcard), writing chosen colours back into the constraint cells. Optional repetition reduction scans 3×2/2×3 windows and recolors matching centres.

**Connectivity trick:** make each half-square internally fully connected to all its outward edges; connect the interior edge between halves only *sometimes*. Global connectivity for free, with meandering paths.

**Applicability verdict:** Barrett himself proposes it for city grids ("hexagonal tiles were a poor match for street grids, which are normally rectangular… Herringbone Tiles with rotation appear to be somewhat isomorphic to hexagonal tiles"). But it is **grid-aligned and authored** — it cannot produce a radial street pattern, a curtain wall following a Voronoi hull, or wedge-shaped medieval lots. **Correct use is hybrid:** Voronoi/streamline for the macro skeleton, herringbone Wang tiles to fill *regular quarters* (a bastide district, a Roman-grid core, docks, barracks) where authored micro-detail beats procedural subdivision. The wildcard mechanism + "pre-place unique tiles, then fill" property is exactly right for landmark placement.

### C6. Amit Patel / Red Blob Games (**MIT**)

**`Roads.as` in mapgen2** (https://github.com/amitp/mapgen2) — contour-following roads, ideal for the hinterland network:
```
elevationThresholds = [0, 0.05, 0.37, 0.64];       // 3 contour bands
// seed: every coast/ocean center gets centerContour = 1
// BFS: newLevel = centerContour[p];
//      while (r.elevation > elevationThresholds[newLevel] && !r.water) newLevel++;
//      if (newLevel < centerContour[r]) { centerContour[r] = newLevel; queue.push(r); }
// cornerContour[q] = MIN over adjacent centers
// edge is a ROAD iff cornerContour[v0] != cornerContour[v1]
```
Roads are exactly the **boundaries between elevation bands** on the Voronoi dual — cheap, always connected, always terrain-following. The `!r.water` clause "extends the contour line past bodies of water so roads don't terminate inside lakes." **Adapt directly: draw main streets on boundaries between *density* bands instead of elevation bands.**

**`NoisyEdges.as`** — the single most stealable routine for making a Voronoi city not look like a Voronoi city:
```as3
NOISY_LINE_TRADEOFF = 0.5;   // low: jagged Voronoi edge; high: jagged Delaunay edge
minLength = 10;                                    // default recursion floor
if (d0.biome != d1.biome) minLength = 3;
if (d0.ocean && d1.ocean)  minLength = 100;        // open water stays straight
if (d0.coast || d1.coast)  minLength = 1;          // coasts very jagged
if (edge.river || lava)    minLength = 1;

subdivide(A,B,C,D):
  if (|A−C| < minLength || |B−D| < minLength) return;
  p = rand(0.2,0.8); q = rand(0.2,0.8);
  E = lerp(A,D,p); F = lerp(B,C,p); G = lerp(A,B,q); I = lerp(D,C,q);
  H = lerp(E,F,q);                                 // displaced midpoint
  s = 1 − rand(−0.4,+0.4); t = 1 − rand(−0.4,+0.4);
  subdivide(A, lerp(G,B,s), H, lerp(E,D,t)); points.push(H);
  subdivide(H, lerp(F,C,s), C, lerp(I,D,t));
```
Recursive quadrilateral midpoint displacement **constrained to stay inside the Voronoi/Delaunay quad** ⇒ jagged but non-self-intersecting and **shared between both adjacent cells (no cracks)**. Apply to ward boundaries, walls, river banks. The per-edge-type `minLength` is the whole art.

**Voronoi maps tutorial** (https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/): jittered grid with `jitter = 0.5`, `x + jitter*(random() − random())` (triangular distribution); Delaunator; and critically — **use centroids rather than circumcenters** for Voronoi cells, which avoids degenerate spikes. That's a direct improvement over Watabou's raw-circumcenter patches. Also https://www.redblobgames.com/pathfinding/a-star/introduction.html (Watabou's `aStar` is a degraded Dijkstra; this is the reference for doing it properly).

---

## PART D — BUILDING SHAPE VARIETY

### D1. CGA Shape — Müller et al., *Procedural Modeling of Buildings* (SIGGRAPH 2006)
PDF: https://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf (27.9 MB; the host returns 406 without a browser User-Agent)

**Scope.** A shape = symbol + geometry + numeric attributes. Geometric attributes are position `P`, three orthogonal vectors `X, Y, Z`, and a size vector `S` — together an **oriented bounding box called the scope**. Rules have the form `id: predecessor : cond ; successor : prob`. Derivation is **priority-ordered breadth-first** (select the shape whose rule has highest priority) so it proceeds low-detail → high-detail. Replaced shapes are marked inactive, not deleted, so the derivation tree stays queryable.

**Operations:**
- **Scope rules:** `T(tx,ty,tz)` translate, `Rx/Ry/Rz(angle)` rotate, `S(sx,sy,sz)` set size, `[` `]` push/pop scope stack, `I(objId)` instance a primitive (cube, quad, cylinder, or any mesh).
- **Basic split:** `Subdiv("Y",3.5,0.3,3,3,3){ floor | ledge | floor | floor | floor }`. Axes `"X"/"Y"/"Z"` and multi-axis `"XY"/"XZ"/"YZ"/"XYZ"`.
- **Relative sizes:** suffix `r`. `Subdiv("X",2,1r,1r,2){ B | A | A | B }`, where `rᵢ` is substituted as `rᵢ·(Scope.sx − Σabsᵢ)/Σrᵢ`. Absolute by default. This is what makes rules scale-invariant — Watabou has no equivalent.
- **Repeat:** `Repeat("X",2){ B }`, `repetitions = ⌈Scope.sx/2⌉`, element size adjusted to fit.
- **Component split:** `Comp(type,param){A|B|...}` — drops dimensionality. `Comp("faces")`, `Comp("edges")`, `Comp("vertices")`, `Comp("sidefaces")`, `Comp("edge",3)`, `Comp("sideedges")`, `Comp("topedges")`. Lower-dimensional shapes use scopes with zero-size axes; `S` with a nonzero value re-extrudes.

**Mass models — the L/U/T mechanism.** "Building mass models are most naturally constructed as a **union of volumetric shapes**… the basic building blocks **L, H, U and T**." The paper's actual four-rule stochastic mass generator, which is directly portable to medieval buildings:
```
PRIORITY 1:
1: lot ; S(1r, building height, 1r)
      Subdiv("Z", Scope.sz*rand(0.3,0.5), 1r){ facades | sidewings }
2: sidewings ;
      Subdiv("X", Scope.sx*rand(0.2,0.6), 1r){ sidewing | ε }
      Subdiv("X", 1r, Scope.sx*rand(0.2,0.6)){ ε | sidewing }
3: sidewing
      ; S(1r, 1r, Scope.sz*rand(0.4,1.0)) facades : 0.5
      ; S(1r, Scope.sy*rand(0.2,0.9), Scope.sz*rand(0.4,1.0)) facades : 0.3
      ; ε : 0.2
4: facades ; Comp("sidefaces"){ facade }
```
Rule 2 emits a wing on each side independently — **that gives you L (one wing), U (two wings), or I (none), and the gap between the wings is the courtyard**. Rule 3's `0.5 / 0.3 / 0.2` probabilities set wing height/depth variety. **Four rules, entire mass-model vocabulary.** Watabou has literally nothing here.

**Imported/GIS footprints:** "we use a **general extruded footprint together with a general roof obtained by a straight skeleton computation** [Aichholzer et al. 1995; Eppstein and Erickson 1999] as shape primitives." Roof types shown: gambrel, cone, gabled, hipped, cross-gable, mansard. Rule form: `Roof("hipped", roof angle){ roof }`.

**The hard problem the paper names:** "The union of simple volumetric shapes leads to complex polygons on the building shell: the resulting polygons can be **concave, have many vertices, and multiple holes**." Computing visible façade surfaces directly fails because (1) they're general polygons, (2) you can't write meaningful shape rules for general polygons, (3) there's no way to assign non-terminal symbols to algorithm output. **The solution is not to compute them — it's occlusion queries + snapping.**

**Occlusion query.** `Shape.occ(subset)` returns `"none" | "part" | "full"`:
```
1: tile : Shape.occ("noparent") == "none" ; window
2: tile : Shape.occ("noparent") == "part" ; wall
3: tile : Shape.occ("noparent") == "full" ; ε
```
Subsets: `"all"`, `"active"` (skip inactive shapes), a label (`Shape.occ("balcony")`), or `"noparent"` (everything except the current shape's predecessors — essential, since a split's parent always occludes its children). Variants: `Shape.occ("noparent","distance",4)` tests the shape enlarged by 4; `Shape.visible("street")` tests sightlines to street geometry. Accelerated with an **octree** (chosen for simplicity given frequent runtime modification).

**Snap lines.** All faces of the mass model's volumetric shapes are stored as **global construction planes**. A planar scope intersected with those planes yields snap lines. Behaviour: **(1) for a `Repeat`, the snap lines divide the scope into parts and the repeat is invoked for each part separately; (2) for a `Subdiv`, the snap line only alters the closest split, leaving everything else unmodified.** Syntax uses `"XS"` instead of `"X"` to snap, plus `Snap(axis, label)`:
```
1: floors ; Repeat("Y", floor height){ floor Snap("XZ") }
2: entrance ; Snap("Y","entrancesnap") door
3: floor ; Repeat("XS", tile width){ tile }
```
This is what makes floor levels **automatically align across all solids of a compound mass** — the thing that makes L-shaped and wing-and-courtyard buildings read as one building rather than three boxes.

### D2. Kelly & Wonka, *Interactive Architectural Modeling with Procedural Extrusions* (TOG 30(2), 2011)
PDF: https://peterwonka.net/Publications/pdfs/2011.TOG.Kelly.ProceduralExtrusions.TechreportVersion.final.pdf · DOI https://dx.doi.org/10.1145/1944846.1944854 · thesis *Procedural Modeling with the Straight Skeleton* https://theses.gla.ac.uk/4975/ · code (**Apache-2.0**) https://github.com/twak/campskeleton

**The generalisation:** each footprint edge gets its own **direction plane angle θ ∈ [−π/2, π/2]**, measured clockwise from vertical. `θ = 0` vertical wall; `θ > 0` slopes inward; **`θ < 0` slopes outward (overhang)**. A **profile** is a polyline whose segments define a *sequence* of angles θ₁…θₘ₋₁ for one edge — so a single edge can be vertical wall, then eaves, then roof pitch.

**Algorithm — a 3D sweep, not 2D:**
1. For every corner where three consecutive edges meet, intersect their three direction planes → an initial event at height z.
2. Sweep the plane upward, maintaining an **active plan** (the cross-section at current height). "To extrude a plan, each plan edge moves to be colinear with the intersection of the direction and sweep planes." Edges shrink and collide.
3. Faces lie on direction planes, extruded upward until constrained by the next event.
Output is a half-edge structure with ℝ³ vertices → an architectural shell mesh.

**Event types beyond the classical skeleton:**

| Event | Trigger | Effect |
|---|---|---|
| **Generalized intersection** | 3+ direction planes collide at a point (unifies edge/split/vertex events) | update active-plan topology, remove vanished edges, relink |
| **Edge direction** | profile polyline changes direction | update θ for a set of active edges mid-extrusion |
| **Profile offset** | user specifies an overhang at a height | insert offset boundary regions, apply inner/outer profiles |
| **Anchor** | user marks a feature | place windows/doors/chimneys/dormers persistently across edits |

**L / U / courtyard handling:** the plan is "a planar partition… that divides a plane into inside and outside regions"; **holes are explicit** — "polygons are typically oriented counter-clockwise, but polygons describing holes are oriented clockwise. Additional bounded regions may be recursively located inside a hole." **Courtyards are interior holes, each extruded with its own direction planes.** L/U shapes arise from split events when "two adjacent direction planes, and one non-adjacent direction plane collide," subdividing the region.

**Concrete robustness constants** (determined by trial and error over their 6,000-floorplan set): `δ₁ = 10⁻⁴` (height clustering), `δ₂ = 10⁻⁶` (xy radius), `δ₃ = 10⁻⁵` (epsilon expansion for edge-collision detection).

**Ambiguity resolution:** default priority is the **volume-maximizing heuristic** — prefer the edge with the lowest (closest to −π/2) angle θ. "This empirically matches most roof designs."

**Near-horizontal case:** when `θ ≈ ±π/2` planes are parallel and don't intersect; the system does a **recursive application of procedural extrusions** with modified angles, then projects onto the sweep plane.

**Validated at scale:** 6,000 Atlanta buildings → 3M polygons, 20 min modeling + 10 min computation, with only **two roof planes computed incorrectly**. Handles curved roofs, overhanging roofs, dormer windows, interior dormers, vertical-walled roof constructions, buttresses, chimneys, bay windows, columns, pilasters, alcoves. Failure rate in interactive use: "once in every 5 minutes of interactive editing with multiple edits per second."

### D3. Cruciform churches and cathedrals — practical construction

No single paper covers this; the implementable recipe combines the above:

1. **Footprint as a union of oriented rectangles** (CGA §D1 mass modeling). A cruciform church is `nave ∪ transept ∪ chancel`, optionally `∪ apse` (semicircle or polygon) and `∪ crossing tower`.
2. **Orientation:** liturgically east-facing. Set the nave's long axis to the *ward's* dominant street direction only if it's within ~45° of east; otherwise force east and let the churchyard absorb the misalignment — misalignment against the surrounding grain is itself a strong realism cue.
3. **Roof by straight skeleton** on the union footprint (§A4 / §D2). Because the union is concave with reflex corners at the crossing, the skeleton produces the **cross-gable** automatically — this is exactly the "cross-gable" roof type listed in CGA's Figure 7, and precisely why Kelly & Wonka's split-event handling matters. Nothing else you can build produces a correct cross-gable from an arbitrary cruciform footprint.
4. **Precinct, not building** (§B4): reserve a churchyard/close polygon around it first, then place the church inside. Salisbury's close is >32 ha; a parish churchyard is far smaller but still a reserved parcel that *interrupts the plot series*.
5. **Density:** 1 parish church per ~250–350 inhabitants (§B4).
6. **Courtyard buildings** (cloisters, inns, guild halls, patrician houses): use `Cutter.ring(block, thickness)` (§C1) or Vanegas' `subdivSkeleton` with small `d_offset` — the ring is the built range, the discarded core is the courtyard. Watabou already computes the ring and **throws the core away**; keep it and label it a courtyard.

---

## PART E — SYNTHESIS: a pipeline that beats Watabou

### E1. Recommended architecture

```
1. TERRAIN & CONTEXT
   - height field, water bodies, regional road bearings arriving at the site
   - population P → walled area A = k·P^0.714   [B3]
   - density gradient target: 200 inh/ha centre → 75 inh/ha edge  [B3]

2. GROWTH HISTORY (this is the differentiator — Watabou has none)
   - epoch 0: nucleus (castle/ford/abbey/crossroads) + market
   - epochs 1..n: expand; at each epoch freeze a wall circuit
   - every superseded wall line becomes a FIXATION LINE → INNER FRINGE BELT
     (cemeteries, friaries, gardens, hospitals, prisons: large parcels, low BCR)  [B1]

3. STREET SKELETON  (NOT Voronoi edges)
   - major roads: tensor field  [A2]  with dsep hierarchy 400 / 100 / 20
     · radial elements at gates and market; grid elements in planned quarters;
       height-field element on slopes; boundary element on the river
     · Perlin rotation field R1 ∈ [−π/2, π/2] for organic curvature
   - OR: extended L-system  [A1] with radial rule at the core, NY rule in bastide quarters
   - contour-band trick for hinterland roads  [C6]

4. BLOCK EXTRACTION
   - planar graph faces; reject faces with >20 vertices  [C4]

5. PARCELS  ← THE BIG WIN
   - subdivSkeleton(block)  [A3] with:
       d_offset  = plot depth   (35 / 60 / 90 / 100 m ladder)   [B1]
       Wmin,Wmax = 8–10 m modal frontage, quantised to ¼-unit   [B1]
       ω         = 0.15–0.30 split irregularity
       ξ         = 0.9 near main streets, 0.3 in backlands
   - emit as PLOT SERIES sharing a frontage line + depth, not independently  [B1]
   - leftover interior = backland → back lane (5–7 m) or courtyard
   - subdivOBB [A3] only for irregular leftovers and suburbs

6. BURGAGE CYCLE  (apply per plot series, age-dependent)
   - phase 1 fill backland toward climax BCR
   - phase 2 clear; phase 3 urban fallow
   - then amalgamate 2–4 plots and redevelop at coarser grain
   - truncate tails into tail-end plots fronting the back lane  [B1]
   - cycle ≈ 180 years (Alnwick)

7. BUILDINGS
   - mass model: CGA 4-rule wing generator  [D1] → I / L / U / courtyard
   - roof: weighted straight skeleton  [D2/A4]; cross-gable falls out for cruciform
   - occlusion query + snap lines so compound masses read as one building  [D1]

8. ENCROACHMENT PASS
   - narrow streets by 1.6–2.9 m (mean 2.2) in older quarters  [B2]
   - infill 20–40% of the market square with a building island  [B2]

9. SUBURBS
   - ribbon growth from each gate, up to 1.36× intramural area  [B3]

10. RENDER
   - noisy edges on ward boundaries / walls / river  [C6], per-edge-type minLength
```

### E2. Parameter cheat-sheet (metric, ready to code)

```
UNIT          1 perch = 5.0292 m — quantise all plot dims to this
FRONTAGE      modal 8.53–9.75 m; range 5–40 m; ¼-unit increments; ±0.5 m tolerance
DEPTH         {35, 60, 90, 100, 201} m ;  W:D ∈ {1:2–1:3.5 core, 1:5–1:6 default, 1:10 tail}
BACK LANE     4.9–7.3 m  (bastide venelle 1–3 m; androne 0.25–0.40 m)
STREETS       market 15–23 m | main 6–10 m | secondary 5–6 m | lane 2.5–5 m
MARKET        95×95 m … 213×178 m planned; 40×40–70×70 m bastide; 2–3 streets per side/corner
BLOCK         short axis 50–70 m (two 24 m plot depths + lane); long axis 70–200 m
WALL          towers every 30–60 m; gates every 250–350 m (dense) or 700–850 m (4-bar)
              ditch 18–20 m wide × 6–12 m deep; reserve 35–50 m clear band outside
AREA          A ≈ k·P^0.714 ; typical 20–81 ha ; 13 plots/ha gross (Winchelsea)
DENSITY       200 inh/ha centre → 75 inh/ha periphery
CHURCHES      1 per 250–350 people ; cathedral close up to 32 ha, walled, own gates
CASTLE        tangent to wall, exactly 2 gates (one outward, one to town)
```

### E3. Acceptance metrics (test your output against real cities)

Compute these on your generated graph and compare to §B5:
- avg node degree **2.5–2.8** organic / 3.0–3.5 grid
- dead-end fraction **~14%** (organic can go to 39%)
- degree-4 fraction **~18%** organic, ~2× that for grid
- median street segment **63–78 m** (W/S Europe)
- circuity **~6.5%** organic vs ~5% grid
- orientation-order **0.02–0.05** organic vs 0.1–0.3 planned
- intersection density **95–116 /km²** organic
- **Gini of eigenvector centrality 0.71 organic vs 0.47 grid** ← the single best organic/planned discriminator
- block area distribution should be a **power law**

Watabou's output will fail the Gini test badly (Voronoi cell edges give near-uniform centrality) — that's your provable improvement.

### E4. Licensing

| Project | License | Copy code? |
|---|---|---|
| watabou/TownGeneratorOS | **GPL-3.0** | No — but algorithms/constants aren't copyrightable; reimplement |
| Watabou live MFCG / Village Generator | closed | No |
| Azgaar/Fantasy-Map-Generator | **MIT** | Yes |
| ProbableTrain/MapGenerator | GPL-3.0 + LGPL-3.0 | LGPL parts linkable; GPL parts viral |
| Flokey82/go_gens | **Apache-2.0** | Yes |
| phiresky/procedural-cities | **AGPL** | Avoid for SaaS |
| t-mw/citygen-godot | **MIT** | Yes |
| LAVS-TM/Map-Generation | **MIT** | Yes |
| nothings/stb (herringbone) | **Public domain / MIT** | Yes |
| amitp/mapgen2 | **MIT** | Yes |
| twak/campskeleton | **Apache-2.0** | Yes |
| CGAL Straight_skeleton_2 | GPL / commercial | Check; campskeleton is the permissive alternative |

### E5. Interop

Accept MFCG's query string so you drop into Azgaar FMG's ecosystem:
`?name&population&size&seed&river&coast&farms&citadel&urban_castle&hub&plaza&temple&walls&shantytown&gates&sea`, with `size = clamp(ceil(2.13·(pop/urbanDensity)^0.385), 6, 100)`.

---

## Local checkouts available for follow-up
`/home/claude/TownGeneratorOS` · `/home/claude/FMG`, `/home/claude/FMG199` · `/home/claude/mapgen` (ProbableTrain) · `/home/claude/mapgen2` (Amit) · `/home/claude/pcities` (phiresky) · `/home/claude/citygen` (t-mw) · `/home/claude/lavs` · `/home/claude/gogens` · `/tmp/cga2.pdf` + `/tmp/cga.txt` (CGA Shape full text)

## Gaps flagged
- **Conzen's *Alnwick* (1960) is not online.** The burgage-cycle BCR thresholds and Alnwick plot-depth series exist only in the print monograph / behind the Springer paywall.
- Keith Lilley's *Antiquity* "Designs and designers of medieval new towns in Wales" has per-town metrological tables for all 13 Edward I towns but is [paywalled](https://www.cambridge.org/core/journals/antiquity/article/abs/designs-and-designers-of-medieval-new-towns-in-wales/5F2B4C5ED16C8DA5BFDFC575C3981FFF). The free [ADS atlas](https://archaeologydataservice.ac.uk/archives/view/atlas_ahrb_2005/atlas.cfm) gives area + axis dimensions per town — scrape `atlas.cfm?town=<name>` for the full dataset.
- Watabou's village-generator devlogs are Patreon-paywalled; only the tag vocabulary is recoverable.
- The session's WebSearch budget (200 calls) was exhausted mid-research; later discovery was done via `git clone`, `curl`, and WebFetch against derived URLs.

## Sources
[Parish & Müller 2001](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf) · [Chen et al. 2008](https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf) · [Chen project page](https://www.sci.utah.edu/~chengu/street_sig08/street_project.htm) · [Vanegas et al. 2012](https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf) · [Vanegas DOI](https://doi.org/10.1111/j.1467-8659.2012.03047.x) · [Müller et al. 2006 CGA Shape](https://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf) · [Kelly & Wonka 2011](https://peterwonka.net/Publications/pdfs/2011.TOG.Kelly.ProceduralExtrusions.TechreportVersion.final.pdf) · [Kelly thesis](https://theses.gla.ac.uk/4975/) · [CGAL Straight_skeleton_2](https://doc.cgal.org/latest/Straight_skeleton_2/index.html) · [campskeleton](https://github.com/twak/campskeleton) · [TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) · [MFCG live](https://watabou.github.io/city-generator/) · [Village Generator](https://watabou.itch.io/village-generator) · [Azgaar FMG](https://github.com/Azgaar/Fantasy-Map-Generator) · [ProbableTrain MapGenerator](https://github.com/probabletrain/mapgenerator) · [go_gens](https://github.com/Flokey82/go_gens) · [phiresky/procedural-cities](https://github.com/phiresky/procedural-cities) · [citygen-godot](https://github.com/t-mw/citygen-godot) · [tmwhere write-up](http://tmwhere.com/city_generation.html) · [LAVS-TM/Map-Generation](https://github.com/LAVS-TM/Map-Generation) · [github topics/city-generator](https://github.com/topics/city-generator) · [Herringbone Wang Tiles](https://nothings.org/gamedev/herringbone/) · [stb_herringbone_wang_tile.h](https://github.com/nothings/stb/blob/master/stb_herringbone_wang_tile.h) · [amitp/mapgen2](https://github.com/amitp/mapgen2) · [Red Blob Voronoi tutorial](https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/) · [Red Blob A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) · [PSAS Tait, Scottish burgage plots](https://journals.socantscot.org/index.php/psas/article/download/9724/9691/9675) · [burgageplots.info](https://www.burgageplots.info/a-planned-approach) · [burgageplots glossary](https://www.burgageplots.info/glossary-of-terms) · [Hungerford Virtual Museum](https://www.hungerfordvirtualmuseum.co.uk/index.php/10-themes/954-burgage-plots) · [Alnwick Civic Society](https://alnwickcivicsociety.org.uk/2020/09/11/rods-poles-and-perches/) · [VCH Wilts vi Salisbury](https://www.british-history.ac.uk/vch/wilts/vol6/pp69-72) · [VCH Salisbury market place](https://www.british-history.ac.uk/vch/wilts/vol6/pp85-87) · [VCH Warks iii Stratford](https://www.british-history.ac.uk/vch/warks/vol3/pp247-258) · [Haslam, Bridgnorth & Ludlow](https://jeremyhaslam.wordpress.com/wp-content/uploads/2009/12/bridgnorth-and-ludlow-town-plans.pdf) · [Urban History, Scottish burgage plots](https://www.cambridge.org/core/journals/urban-history/article/framework-and-form-burgage-plots-street-lines-and-domestic-architecture-in-early-urban-scotland/4FC18665945BC7A9144C4C9165838A5A) · [Hildesheim Dammstadt](https://www.academia.edu/6125759/12_Ruten_lang_6_Ruten_breit_%C3%9Cberlegungen_zur_Grundst%C3%BCcksaufteilung_in_der_Dammstadt_von_Hildesheim) · [Gdańsk tenements](https://www.mdpi.com/2075-5309/11/3/80) · [Conzen 1960 Alnwick](https://www.researchgate.net/publication/240739085_Conzen_MRG_1960_Alnwick_Northumberland_A_study_in_town-plan_analysis_Institute_of_British_Geographers_Publication_27_London_George_Philip) · [EPUM Briefing Paper 1](https://www.surf.com.cy/wp-content/uploads/2023/03/EPUM_BP1_Historical-Geographical.pdf) · [Springer, burgage cycle morphometry](https://link.springer.com/chapter/10.1007/978-3-030-87016-4_35) · [Łódź fringe-belt analysis](https://czasopisma.uni.lodz.pl/fgsoe/article/download/1205/874/0) · [Back lane](https://en.wikipedia.org/wiki/Back_lane) · [fr.wikipedia Bastide](https://fr.wikipedia.org/wiki/Bastide_(ville)) · [Esprit de Pays, cadre urbain des bastides](https://espritdepays.com/patrimoines-en-perigord/patrimoine-bati-du-perigord/les-bastides-du-perigord/cadre-urbain-des-bastides) · [French Moments Monpazier](https://frenchmoments.eu/monpazier-dordogne/) · [Cornell Bastides Collection](https://exhibits.library.cornell.edu/bastides-collection/feature/monpazier) · [ADS Mapping the Medieval Townscape](https://archaeologydataservice.ac.uk/archives/view/atlas_ahrb_2005/atlas.cfm) · [Winchelsea](https://www.winchelsea.com/the-town-story/history/new-winchelsea/) · [Main Square Kraków](https://en.wikipedia.org/wiki/Main_Square,_Krak%C3%B3w) · [Market Square Wrocław](https://en.wikipedia.org/wiki/Market_Square,_Wroc%C5%82aw) · [New Town Market Square Toruń](https://en.wikipedia.org/wiki/New_Town_Market_Square,_Toru%C5%84) · [Northants HER Northampton](https://her.northamptonshire.gov.uk/Monument/MNN13703) · [Northants HER Long Buckby](https://her.northamptonshire.gov.uk/Monument/MNN103184) · [Designing Buildings, road dimensions](https://www.designingbuildings.co.uk/wiki/The%20history%20of%20the%20dimensions%20and%20design%20of%20roads,%20streets%20and%20carriageways) · [Walls of Ávila](https://en.wikipedia.org/wiki/Walls_of_%C3%81vila) · [Norwich city walls](https://en.wikipedia.org/wiki/Norwich_city_walls) · [York city walls](https://en.wikipedia.org/wiki/York_city_walls) · [Southampton town walls](https://en.wikipedia.org/wiki/Southampton_town_walls) · [City walls of Nuremberg](https://en.wikipedia.org/wiki/City_walls_of_Nuremberg) · [Urban castle](https://en.wikipedia.org/wiki/Urban_castle) · [Encyclopedia.com, Urban Fortifications](https://www.encyclopedia.com/history/news-wires-white-papers-and-books/urban-fortifications-and-public-places) · [PLOS ONE, medieval population-area](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678) · [Leiden, Ranking the towns](https://www.universiteitleiden.nl/en/research/research-projects/archaeology/ranking-the-towns) · [Medieval parish churches of York](https://en.wikipedia.org/wiki/Medieval_parish_churches_of_York) · [Salisbury Cathedral Close](https://www.salisburycathedral.org.uk/visit-what-see/largest-cathedral-close) · [Popular Archaeology, medieval city regulation](https://popular-archaeology.com/article/inside-a-medieval-city-public-health-housing-and-everyday-regulations/) · [Oxoniensia, Oxford Castle](https://oxoniensia.org/volumes/2009/poore.pdf) · [Oakford Archaeology, St Sidwell Exeter](https://www.oakfordarch.co.uk/the-ancient-parish-of-st-sidwell-exeter/) · [Boeing, street network indicators](https://escholarship.org/content/qt5db3f718/qt5db3f718.pdf) · [Boeing, street network orientation](https://geoffboeing.com/2019/09/urban-street-network-orientation/) · [Barthelemy, street network review](https://arxiv.org/pdf/2409.08016) · [PMC, pre-industrial street network centrality](https://pmc.ncbi.nlm.nih.gov/articles/PMC8585513/)

agentId: a8fa1e4a2387f1046 (use SendMessage with to: 'a8fa1e4a2387f1046', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 170054
tool_uses: 33
duration_ms: 2667900</usage>

---

<!-- fuente: city-sources-licensing.md -->

I've read all the primary sources. Here is the full technical extraction.

---

# 1) WATABOU — TownGeneratorOS (Medieval Fantasy City Generator)

**Repo:** https://github.com/watabou/TownGeneratorOS — **LICENSE: GNU GPL v3** (`/home/claude/TownGeneratorOS/LICENSE`). Copyleft — you cannot lift this code into a closed-source product. The README states it is an *older* version of the live MFCG ("lacks waterbodies, options UI"). Language: Haxe + OpenFL. Single commit HEAD `7fbc87a`.

Live (non-OSS, newer) build: https://watabou.github.io/city-generator/ (bundle `mfcg.js`, Closure-minified).

### 1.1 Top-level pipeline — `Source/com/watabou/towngenerator/building/Model.hx`, `Model.build()` (L87)

```
buildPatches() → optimizeJunctions() → buildWalls() → buildStreets() → createWards() → buildGeometry()
```
Wrapped in `do{...}catch(Error)` retry loop (L78-84): on any thrown error ("Bad citadel shape!", "Bad walled area shape!", "Unable to build a street!") the *whole city is regenerated*. Rejection sampling is core to the design.

### 1.2 Voronoi seeding — `Model.buildPatches()` (L99)

```haxe
var sa = Random.float() * 2 * Math.PI;                       // global spiral phase
var points = [for (i in 0...nPatches * 8) {                  // 8x oversampling!
    var a = sa + Math.sqrt(i) * 5;                           // angle, radians
    var r = (i == 0 ? 0 : 10 + i * (2 + Random.float()));    // radius
    new Point(Math.cos(a)*r, Math.sin(a)*r);
}];
var voronoi = Voronoi.build(points);
```
- **Not** blue noise / not Poisson / not a jittered grid. It's a **sqrt-angle spiral (phyllotaxis-like)**: `dθ/di = 5/(2√i)` (decreasing), `r ≈ 2.5·i` (linear). Arc spacing between consecutive seeds ≈ `6.25·√i`, radial spacing ≈ 2.5. Result: dense center, coarser periphery, no seed collisions, deterministic-ish structure.
- **8× more seeds than patches** — only the innermost `nPatches` become city; the rest become countryside/farms and are later culled.

**Relaxation (L108-113)** — extremely selective, not global Lloyd:
```haxe
for (i in 0...3) {                                   // 3 iterations
    var toRelax = [voronoi.points[0], points[1], points[2]];
    toRelax.push(voronoi.points[nPatches]);          // the citadel candidate
    voronoi = Voronoi.relax(voronoi, toRelax);
}
```
Only the 3 innermost seeds + the citadel seed get Lloyd-relaxed (moved to their region's average circumcenter, `Voronoi.relax` L136 / `Region.center()` L229). Everything else keeps the raw spiral geometry. This is *why* the plaza/citadel are well-shaped but outer wards are irregular.

**Ordering (L115-117):** `voronoi.points.sort(by |p|)` ascending, then `partioning()` returns regions in that order, skipping any region touching a frame vertex.

**Assignment (L122-143):**
| index | role |
|---|---|
| `count == 0` | `center = patch.shape.min(v -> v.length)` (vertex nearest origin); if `plazaNeeded` this patch **is** the plaza |
| `count < nPatches` | `withinCity = true`, `withinWalls = wallsNeeded`, pushed to `inner` |
| `count == nPatches` | if `citadelNeeded`, **citadel** (`withinCity = true`, but *not* in `inner`) |

**Global flags** (L74-76): `plazaNeeded = Random.bool()`, `citadelNeeded = Random.bool()`, `wallsNeeded = Random.bool()` — each **50%**.

**Sizes** (`Model.hx` L24-29 comment + `ui/CitySizeButton.hx` via `TownScene.hx` L30-33):
`Small Town 6–10 · Large Town 10–15 · Small City 15–24 · Large City 24–40 · Metropolis 40`. Default `nPatches = 15`.

**Voronoi impl** (`geom/Voronoi.hx`): incremental Bowyer–Watson. Frame = bbox expanded by `dx/2, dy/2` where `dx = (maxx-minx)*0.5` (L163-166). `Triangle` stores circumcenter `c` and radius `r`; `addPoint` re-triangulates all triangles whose circumcircle contains `p`. Patch polygon = the region's circumcenters sorted by angle (`Region.compareAngles`, L247).

**RNG** (`utils/Random.hx`): Lehmer LCG, `g = 48271.0`, `n = 2147483647`, `seed = (seed*g) % n`. `normal()` = mean of 3 uniforms. `fuzzy(f)` = `(1-f)/2 + f*normal()`.

### 1.3 Junction cleanup — `Model.optimizeJunctions()` (L308)

For every inner patch (+citadel), walk vertices; if `Point.distance(v0, v1) < 8` (**hard-coded 8 world units**):
1. every other patch sharing `v1` has that reference rewritten to `v0`;
2. `v0 = (v0 + v1) * 0.5` (mutated in place — vertices are *shared object references* across patches, which is the whole trick that keeps the mesh topologically consistent);
3. `v1` removed from the polygon.
Then a duplicate-vertex removal pass. This eliminates the near-degenerate Voronoi edges that would otherwise produce ugly slivers.

### 1.4 Curtain wall & gates — `building/CurtainWall.hx`

**Shape** (L26-37):
```haxe
shape = Model.findCircumference(patches);      // union outline of `inner`
if (real) {
    var smoothFactor = Math.min(1, 40 / patches.length);
    shape = [for (v in shape) reserved.contains(v) ? v : shape.smoothVertex(v, smoothFactor)];
}
```
`smoothVertex(v, f) = (prev + v*f + next)/(2+f)` (`Polygon.hx` L144). So `f = min(1, 40/N)`: for N ≤ 40 patches `f = 1` (equal weighting = strong smoothing); larger cities smooth *less*. `reserved` = the citadel polygon's vertices (never moved).

`Model.findCircumference(wards)` (Model L172): collect every directed edge `(a,b)` of every ward for which **no** other ward has the reverse edge `(b,a)` → those are outer edges; then chain them by `index = A.indexOf(B[index])` into a closed ring.

**Gates** — `buildGates()` (L44):
1. **Candidate entrances** = wall vertices that are (a) not `reserved`, and (b) shared by **more than 1** inner patch (`patches.count(p -> p.shape.contains(v)) > 1`). Rationale in comment: "so that a street could connect it to the city center". If the walled area is a single patch, all non-reserved vertices qualify.
2. `if (entrances.length == 0) throw "Bad walled area shape!"` → full regen.
3. **Loop** `do { ... } while (entrances.length >= 3)`:
   - pick `index = Random.int(0, entrances.length)`, `gate = entrances[index]`, push to `gates`.
   - **Outer-ward split**: if exactly one patch outside the wall touches the gate and that patch has `> 3` vertices, split it so a road can exit. Direction: `wall = shape.next(gate) - shape.prev(gate)`; outward normal `out = (wall.y, -wall.x)`; `farthest = outer.shape.max(v -> dir·out / |dir|)` (i.e. the vertex most directly outward); `outer.shape.split(gate, farthest)` → two new `Patch`es replace the old one in `model.patches`.
   - **Spacing enforcement**: `entrances.splice(index-1, 3)` (removes the gate and its two neighbours). Edge cases at index 0 / last handled separately. ⇒ **gates are ≥3 wall vertices apart**; gate count ≈ `floor(|entrances| / 3)`.
4. Finally each gate vertex is itself smoothed: `gate.set(shape.smoothVertex(gate))` (f=1).

**Towers** — `buildTowers()` (L112): **every wall vertex that is not a gate** becomes a tower (given its adjacent `segments[]` flag is true). Drawn as a filled circle of radius `Brush.THICK_STROKE` (1.8), ×1.5 for the citadel wall.

Note quirk L23: `this.real = true;` is assigned unconditionally, ignoring the constructor arg — only the *local* `real` parameter gates the smoothing/splitting logic.

### 1.5 Citadel / Castle — `Model.buildWalls()` (L146) + `wards/Castle.hx`

```haxe
var reserved = citadel != null ? citadel.shape.copy() : [];
border = new CurtainWall(wallsNeeded, this, inner, reserved);
if (wallsNeeded) { wall = border; wall.buildTowers(); }
patches = patches.filter(p -> p.shape.distance(center) < border.getRadius() * 3);  // cull countryside at 3× wall radius
gates = border.gates;
if (citadel != null) {
    var castle = new Castle(this, citadel);
    castle.wall.buildTowers();
    citadel.ward = castle;
    if (citadel.shape.compactness < 0.75) throw new Error("Bad citadel shape!");   // full regen
    gates = gates.concat(castle.wall.gates);
}
```
- `compactness = 4π·area / perimeter²` (`Polygon.hx` L48; circle 1.00, square 0.79, triangle 0.60). Citadel must be **≥ 0.75**.
- `Castle.new` (Castle.hx L17): its own `CurtainWall(true, model, [patch], reserved)` where `reserved` = citadel vertices that touch **any** patch not `withinCity` (so the castle gate faces inward, not out into the countryside).
- `Castle.createGeometry`: `block = patch.shape.shrinkEq(MAIN_STREET*2 = 4)`, then `Ward.createOrthoBuilding(block, Math.sqrt(block.square) * 4, 0.6)`.

### 1.6 Plaza / market

- **Plaza** = patch index 0 (the innermost patch), only if the 50% `plazaNeeded` roll passed. Its ward is `Market` (`Model.createWards` L349).
- Additional `Market` wards are placed by rating (below). `Market.rateLocation`: `+∞` if it would touch another market; otherwise `patch.square / plaza.square` (i.e., prefer markets *not much larger than the plaza*), or `distance(center)` if no plaza.

### 1.7 Streets & roads — `building/Topology.hx` + `Model.buildStreets()` (L211)

**The graph** (`Topology.new`, L22): nodes = **polygon vertices of every patch** (deduped by object identity via `pt2node`); edges = **every polygon edge**, weight = Euclidean length (`n0.link(n1, Point.distance(v0,v1))`). So the street graph is literally the *Voronoi cell boundary graph*, not a separate road network.

- `blocked` = `citadel.shape ∪ wall.shape` **minus** `gates` → `processPoint` returns `null` for blocked points, so they never become traversable nodes. Walls are impassable except at gates.
- `inner[]` / `outer[]` node lists = nodes belonging to `withinCity` / non-city patches, **excluding** vertices on `model.border.shape`.

**Path search** (`geom/Graph.hx` L25 `aStar`): despite the name it is **Dijkstra with no heuristic and a FIFO `openSet.shift()`** — g-scores only, `closedSet` pre-seeded with the `exclude` list. `exclude` is how in/out separation is enforced.

**Street generation** (Model L221-249), for each gate (city gates **and** castle gates):
1. `end = plaza != null ? plaza.shape.min(v -> dist(v, gate)) : center` — nearest plaza corner, else the central junction.
2. `street = topology.buildPath(gate, end, topology.outer)` → **excludes all outer nodes** ⇒ street stays inside the city. `null` ⇒ `throw "Unable to build a street!"` ⇒ full regen.
3. If it is a *border* gate, also build the outbound **road**: pick the topology point nearest to `gate.norm(1000)` (the gate direction extended 1000 units outward), then `topology.buildPath(start, gate, topology.inner)` — **excludes all inner nodes** ⇒ road stays outside.

**`tidyUpRoads()` (L257):** decompose all streets+roads into unique `Segment(v0,v1)` (dropping any segment where *both* endpoints lie on the plaza), then greedily re-chain segments into maximal polylines → `arteries`. Chaining rule: pop a segment, prepend if `a[0] == seg.end`, append if `a.last() == seg.start`, else start a new artery.

**Smoothing (L213-217):** every artery gets `smoothVertexEq(3)` — `v'ᵢ = (vᵢ₋₁ + 3vᵢ + vᵢ₊₁)/5` — written back only for `i ∈ [1, n-2]` so endpoints (gates, plaza corners) stay pinned. Rendering uses `Spline.curvature = 0.1` (`geom/Spline.hx` L11) for Bézier control points.

### 1.8 Ward assignment — `Model.createWards()` (L346)

**The deck** (`Model.WARDS`, L35-42) — 36 entries, consumed in order via `shift()`:
```
CraftsmenWard ×21, Slum ×5, MerchantWard ×2, PatriciateWard ×2, Market ×2,
Cathedral ×1, AdministrationWard ×1, MilitaryWard ×1, Park ×1
```
exact order:
```
Craftsmen, Craftsmen, Merchant, Craftsmen, Craftsmen, Cathedral,
Craftsmen ×5,
Craftsmen, Craftsmen, Craftsmen, Administration, Craftsmen,
Slum, Craftsmen, Slum, Patriciate, Market,
Slum, Craftsmen, Craftsmen, Craftsmen, Slum,
Craftsmen, Craftsmen, Craftsmen, Military, Slum,
Craftsmen, Park, Patriciate, Market, Merchant
```

**Steps:**
1. Plaza → `Market`.
2. **Gate wards**: for each *border* gate, each touching city patch with no ward gets `GateWard` with probability `Random.bool(wall == null ? 0.2 : 0.5)`.
3. **Shuffle**: `for (i in 0...Std.int(wards.length/10))` → **3 adjacent swaps only** for the 36-deck. Nearly deterministic ordering.
4. **Placement loop** while patches remain unassigned:
   ```haxe
   var wardClass = wards.length > 0 ? wards.shift() : Slum;   // everything past 36 patches = Slum
   var rateFunc = Reflect.field(wardClass, "rateLocation");
   if (rateFunc == null) bestPatch = random unassigned patch;
   else bestPatch = unassigned.min(p -> rateLocation(this, p));  // LOWEST score wins
   ```
   **Critical Haxe subtlety:** statics are not inherited, so `Reflect.field` returns `null` for `CraftsmenWard`, `GateWard`, `Park`, `Farm`, `CommonWard` — those get **uniformly random patches**. Only these define `rateLocation`:

| Ward | `rateLocation` (minimised) |
|---|---|
| `MerchantWard` | `patch.shape.distance(plaza.center ?? model.center)` → hug the centre |
| `Slum` | `-distance(plaza.center ?? center)` → maximise distance |
| `AdministrationWard` | `plaza != null ? (borders(plaza) ? 0 : distance(plaza.center)) : distance(center)` |
| `Cathedral` | `borders(plaza) ? -1/patch.square : distance(plaza.center)*patch.square` → prefer big patch touching plaza |
| `Market` | `+∞` if adjacent to another Market; else `patch.square/plaza.square` |
| `MilitaryWard` | `0` if borders citadel; `1` if borders wall; else `+∞` (or `0` if neither citadel nor wall exist) |
| `PatriciateWard` | `Σ over neighbours: -1 per adjacent Park, +1 per adjacent Slum` |

5. **Outskirts** (L392): for each *wall* gate, with probability `1 - 1/(nPatches - 5)`, an outside patch touching that gate is promoted to `withinCity` + `GateWard`.
6. **Countryside** (L402): `cityRadius = max |v|` over all city patch vertices. Every non-city patch becomes `Farm` iff `Random.bool(0.2) && compactness >= 0.7`, else a blank `Ward` (no geometry).

`isEnclosed(patch)` (L432) = `withinCity && (withinWalls || all neighbours withinCity)`.

### 1.9 Block extraction — `Ward.getCityBlock()` (`wards/Ward.hx` L36)

Street-width constants (L18-20):
```haxe
MAIN_STREET = 2.0;  REGULAR_STREET = 1.0;  ALLEY = 0.6;
```
Per-edge inset (half-width, since both sides inset):
| edge condition | inset |
|---|---|
| borders the city wall | `MAIN_STREET/2 = 1.0` |
| lies on an artery, or borders the plaza (inner patch only) | `MAIN_STREET/2 = 1.0` |
| otherwise, inner patch | `REGULAR_STREET/2 = 0.5` |
| otherwise, outer patch | `ALLEY/2 = 0.3` |

Then `patch.shape.isConvex() ? shrink(insetDist) : buffer(insetDist)`:
- **`Polygon.shrink(d[])`** (L350): successively `cut` the polygon by each inward-offset edge line, keeping half[0]. Always convex output, vertex count changes. Reliable for convex.
- **`Polygon.buffer(d[])`** (L246): build a (self-intersecting) offset polygon, then resolve **all** self-intersections by inserting intersection points twice, then walk all sub-loops and **return the largest-area one**. `DELTA = 0.000001`.

### 1.10 `Cutter.hx` — the lot-subdivision primitives

```haxe
bisect(poly, vertex, ratio=0.5, angle=0.0, gap=0.0)      // L13
  p1 = interpolate(vertex, poly.next(vertex), ratio)
  d  = next - vertex
  (vx,vy) = rotate(d, angle)
  p2 = (p1.x - vy, p1.y + vx)                             // perpendicular to the rotated edge
  return poly.cut(p1, p2, gap)
```
```haxe
radial(poly, center=poly.centroid, gap)                   // L29
  for each edge (v0,v1): sector = Polygon([center,v0,v1]); if gap>0 sector.shrink([gap/2, 0, gap/2])
```
```haxe
semiRadial(poly, center=vertex nearest centroid, gap)     // L45
  gap /= 2; skip any sector containing `center` as v0 or v1;
  shrink d = [findEdge(center,v0)==-1 ? gap : 0, 0, findEdge(v1,center)==-1 ? gap : 0]
```
```haxe
ring(poly, thickness)                                     // L67
  for each edge: n = edge.rotate90().norm(thickness); slice = {p1: v1+n, p2: v2+n, len: |edge|}
  slices.sort(by len ASC)          // "Short sides should be sliced first"
  p = poly; for each slice: halves = p.cut(slice.p1, slice.p2); p = halves[0]; if 2 halves push halves[1]
  return peel   // the ring of outer strips; the core `p` is discarded
```

**`Polygon.cut(p1, p2, gap)`** (Polygon.hx L464): intersect the infinite line `p1→p2` against every edge; if exactly 2 hits, split into `half1`/`half2` with the two intersection points inserted; if `gap > 0` each half is `peel`ed back by `gap/2` along the cut line, creating the actual **alley void**. Returned order is determined by `GeomUtils.cross(dx1,dy1, edgeVec) > 0` so half[0] is consistently on one side.

### 1.11 `Ward.createAlleys()` — the recursive building generator (Ward.hx L125)

```haxe
static createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb=0.04, split=true):
  1. v = start vertex of the LONGEST edge of p
  2. spread = 0.8 * gridChaos
     ratio  = (1 - spread)/2 + Random.float() * spread          // centred on 0.5
  3. angleSpread = (Math.PI/6) * gridChaos * (p.square < minSq*4 ? 0.0 : 1)
     b = (Random.float() - 0.5) * angleSpread                   // cut skew, ±15°·gridChaos
        // NOTE: small blocks get angleSpread = 0 → "keep buildings rectangular even in chaotic wards"
  4. halves = Cutter.bisect(p, v, ratio, b, split ? ALLEY(0.6) : 0.0)
  5. for each half:
       if (half.square < minSq * Math.pow(2, 4 * sizeChaos * (Random.float() - 0.5)))
            if (!Random.bool(emptyProb)) buildings.push(half)     // LEAF
       else recurse( half, minSq, gridChaos, sizeChaos, emptyProb,
                     split = half.square > minSq / (Random.float() * Random.float()) )
```
Key behaviours:
- Leaf threshold is **stochastic**: `minSq · 2^(4·sizeChaos·U(-0.5,0.5))` → for `sizeChaos = 0.8` the effective min area varies over `minSq · 2^±1.6` ≈ ×0.33 … ×3.0.
- `split` controls whether the cut leaves a physical **alley gap** (0.6 units) or a shared party wall (0.0). The recursion sets `split = half.square > minSq / (U·U)`; since `U·U` is heavily skewed toward 0, `minSq/(U·U)` is usually huge ⇒ **most deep cuts are gapless** ⇒ terraced row-houses; only large blocks get real alleys.
- `emptyProb` = chance a leaf is discarded → courtyards/gaps.

### 1.12 `Ward.createOrthoBuilding()` — axis-locked variant (Ward.hx L162)

```haxe
createOrthoBuilding(poly, minBlockSq, fill):
  if (poly.square < minBlockSq) return [poly];
  c1 = poly.vector(longestEdge);  c2 = c1.rotate90();
  loop { blocks = slice(poly, c1, c2); if (blocks.length > 0) return blocks; }

slice(poly, c1, c2):
  v0 = start of longest edge; v1 = next(v0); v = v1 - v0
  ratio = 0.4 + Random.float() * 0.2                      // 0.4..0.6
  p1 = interpolate(v0, v1, ratio)
  c  = (|v·c1| < |v·c2|) ? c1 : c2                        // pick the axis more perpendicular to the edge
  halves = poly.cut(p1, p1 + c)                           // NO gap
  for each half:
     if (half.square < minBlockSq * Math.pow(2, Random.normal()*2 - 1))
         if (Random.bool(fill)) buildings.push(half)
     else recurse
```
`Random.normal()` = mean of 3 uniforms ⇒ exponent concentrated near 0, i.e. threshold ≈ `minBlockSq · 2^[-1,+1]`, bell-shaped. Every cut is parallel to one of two fixed global axes ⇒ **rectilinear** compounds (used for Castle, Cathedral, Farm).

### 1.13 Ward parameter table (exact constructor args)

`r` ≡ `Random.float()` (fresh draw each occurrence).

| Ward class | `minSq` | `gridChaos` | `sizeChaos` | `emptyProb` | geometry routine |
|---|---|---|---|---|---|
| `CraftsmenWard` | `10 + 80·r·r` | `0.5 + 0.2r` | `0.6` | 0.04 (default) | `createAlleys` |
| `MerchantWard` | `50 + 60·r·r` | `0.5 + 0.3r` | `0.7` | **0.15** | `createAlleys` |
| `PatriciateWard` | `80 + 30·r·r` | `0.5 + 0.3r` | `0.8` | **0.2** | `createAlleys` |
| `AdministrationWard` | `80 + 30·r·r` | `0.1 + 0.3r` | `0.3` | 0.04 | `createAlleys` |
| `Slum` | `10 + 30·r·r` | `0.6 + 0.4r` | `0.8` | **0.03** | `createAlleys` |
| `GateWard` | `10 + 50·r·r` | `0.5 + 0.3r` | `0.7` | 0.04 | `createAlleys` |
| `MilitaryWard` | `√(block.square)·(1 + r)` | `0.1 + 0.3r` | `0.3` | **0.25** | `createAlleys` (extends `Ward`, not `CommonWard`) |
| `Cathedral` | — | — | — | — | 40%: `Cutter.ring(block, 2 + 4r)`; else `createOrthoBuilding(block, 50, 0.8)` |
| `Park` | — | — | — | — | `compactness ≥ 0.7 ? Cutter.radial(block, null, ALLEY) : Cutter.semiRadial(...)` |
| `Market` | — | — | — | — | see below |
| `Farm` | — | — | — | — | `rect(4,4)` rotated `r·π`, positioned `interpolate(random vertex, centroid, 0.3+0.4r)`, then `createOrthoBuilding(housing, 8, 0.5)` |
| `Castle` | — | — | — | — | `shrinkEq(4)` then `createOrthoBuilding(block, √(block.square)·4, 0.6)` |

`CommonWard.createGeometry` (CommonWard.hx L22): `getCityBlock()` → `createAlleys` → **if `!model.isEnclosed(patch)` call `filterOutskirts()`**.

**`Market.createGeometry`** (Market.hx L14): `statue = Random.bool(0.6)`; `offset = statue || Random.bool(0.3)`. Object = `Polygon.rect(1+r, 1+r)` rotated to the longest edge's angle (statue) or `Polygon.circle(1+r)` = 16-gon (fountain). Position = `interpolate(patch.centroid, midpoint(longest edge), 0.2 + 0.4r)` if offset, else the centroid.

**`Ward.filterOutskirts()`** (Ward.hx L61) — thins buildings at the city fringe:
1. Build `populatedEdges`: for each patch edge, if it's on an artery → `factor = 1`; else if the neighbour patch is `withinCity` → `factor = isEnclosed(neighbour) ? 1 : 0.4`; else skip. For each, `d` = max perpendicular distance from that edge to any patch vertex, ×factor.
2. `density[i]` per vertex = `1` if it's a gate; `2·Random.float()` if all patches at that vertex are `withinCity`; else `0`.
3. Keep building iff `Random.fuzzy(1) > minDist / p`, where `minDist = min over edges of (dist(building vertex, edge)/edge.d)` (clamped ≤1) and `p = Σⱼ density[j]·interpolate(buildingCenter)[j]` (inverse-distance barycentric weights, `Polygon.interpolate` L517).

### 1.14 Rendering constants (`mapping/Brush.hx`, `mapping/Palette.hx`, `mapping/CityMap.hx`)

`NORMAL_STROKE = 0.300`, `THICK_STROKE = 1.800`, `THIN_STROKE = 0.150`.
Roads drawn twice: outer `MAIN_STREET + NORMAL_STROKE = 2.3` in `palette.medium`, inner `MAIN_STREET − NORMAL_STROKE = 1.7` in `palette.paper`. Gates: line of width `THICK_STROKE*2 = 3.6`, length `±THICK_STROKE*1.5 = 2.7` along the wall tangent.
Palettes (paper, light, medium, dark): `DEFAULT 0xccc5b8/0x99948a/0x67635c/0x1a1917`, plus `BLUEPRINT, BW, INK, NIGHT, ANCIENT, COLOUR, SIMPLE`.
Camera: `scale = (scMax/scMin > 2 ? scMax/2 : scMin) * 0.5` where `sc = viewport / cityRadius` (`TownScene.hx` L50-55).

### 1.15 What the *current* (closed-source) MFCG adds

From string extraction of `https://watabou.github.io/city-generator/mfcg.js` (1.31 MB, Closure-minified). Feature tokens present that do **not** exist in TownGeneratorOS:
`BANK, BRIDGE, CANAL, CASTLE, COAST, COMPACT, DOCKS, GATE, PARK, PLAZA, RIVER, ROAD, SHANTY, SPRAWL, TEMPLE, WALL, WALLS, START, TEMPLATE, GUIDE, HORIZON, MULTI, UNIQUE, UNUSED, DistOne, IS REL`
plus error strings `"The rule stack for "`, `"There is no "`, `"No suitable edge to split"` ⇒ the modern version is driven by a **rule/grammar stack** over tagged districts, not a hard-coded `WARDS` array. UI/geometry ops: `Displace, Equalize, Liquify, Shrink, Warp, Relax, Bloat, Offset, Rotate`; render options `show_alleys, show_trees, show_forests, thin_lines, outline_water, outline_roads, outline_solids, tint districts, weathered roofs, Furrows, Gable, Roofs`; export `PNG/SVG/JSON/GeoJSON` (`FeatureCollection, MultiPolygon, LineString`). Districts are called `districts` and there are `landmarks`.

---

# 2) AZGAAR — Fantasy Map Generator

**Repo:** https://github.com/Azgaar/Fantasy-Map-Generator — **LICENSE: MIT** (`Copyright 2017-2024 Max Haniyeu (Azgaar)`).

**Headline finding: FMG has NO city-layout generator.** There is no `modules/city-generator.js` or `modules/village-generator.js` at any tag (I probed `v1.99` raw paths: both 404; current `main` restructured to `src/generators/*.ts` and contains only `burgs-generator.ts` — settlement *placement*, not layout). FMG **delegates the entire building/wall/road layout to Watabou** by URL.

### 2.1 The dispatch — `modules/ui/editors.js` L318 (tag `v1.99`)
```js
function getBurgLink(burg) {
  if (burg.link) return burg.link;
  const population = burg.population * populationRate * urbanization;
  if (population >= options.villageMaxPopulation || burg.citadel || burg.walls || burg.temple || burg.shanty)
    return createMfcgLink(burg);
  return createVillageGeneratorLink(burg);
}
```
The burg editor embeds `getBurgLink(burg) + "&preview=1"` in an `<object>` (`modules/ui/burg-editor.js` L362-366).

### 2.2 `createMfcgLink()` — editors.js L328
```js
const burgSeed = burg.MFCG || seed + String(burg.i).padStart(4, 0);
const sizeRaw  = 2.13 * Math.pow((burgPopulation * populationRate) / urbanDensity, 0.385);
const size     = minmax(Math.ceil(sizeRaw), 6, 100);        // == Watabou's nPatches
const population = rn(burgPopulation * populationRate * urbanization);
const river = cells.r[cell] ? 1 : 0;
const coast = Number(burg.port > 0);
const sea = /* atan2 of cell→haven, normalised: 0=south, 0.5=west, 1=north, 1.5=east, rn(...,2) */;
const arableBiomes = river ? [1,2,3,4,5,6,7,8] : [5,6,7,8];
const farms = +arableBiomes.includes(cells.biome[cell]);
const citadel = +burg.citadel;
const urban_castle = +(citadel && each(2)(i));              // every 2nd burg
const hub = Routes.isCrossroad(cell);
url = "https://watabou.github.io/city-generator/?" +
      {name, population, size, seed, river, coast, farms, citadel, urban_castle,
       hub, plaza, temple, walls, shantytown, gates: -1 [, sea]}
```
The `size ∈ [6,100]` maps 1:1 onto `Model.nPatches`. `2.13·(pop/urbanDensity)^0.385` is the population→patch-count law.

### 2.3 `createVillageGeneratorLink()` — editors.js L385
```js
tags = [];
if (r && haven) "estuary"; else if (haven && feature.cells===1) "island,district";
else if (port) "coast"; else if (conf) "confluence"; else if (r) "river";
else if (pop < 200 && each(4)(cell)) "pond";
roads = count of adjacent routes in group "roads"|"trails";
tags.push(roads > 1 ? "highway" : roads === 1 ? "dead end" : "isolated");
if (!arableBiomes.includes(biome)) "uncultivated"; else if (each(6)(cell)) "farmland";
if (temp <= 0 || temp > 28 || (temp > 25 && each(3)(cell))) "no orchards";
if (!burg.plaza) "no square";
if (pop < 100) "sparse"; else if (pop > 300) "dense";
width = pop>1500?1600 : pop>1000?1400 : pop>500?1000 : pop>200?800 : pop>100?600 : 400;
height = rn(width / 2.2);
url = "https://watabou.github.io/village-generator/?" + {pop, name:"", seed, width, height, tags}
```

### 2.4 The one thing FMG *does* generate: burg feature flags — `modules/burgs-and-states.js` L263-270
```js
b.citadel = Number(b.capital || (pop > 50 && P(0.75)) || (pop > 15 && P(0.5)) || P(0.1));
b.plaza   = Number(pop > 20 || (pop > 10 && P(0.8)) || (pop > 4 && P(0.7)) || P(0.6));
b.walls   = Number(b.capital || pop > 30 || (pop > 20 && P(0.75)) || (pop > 10 && P(0.5)) || P(0.1));
b.shanty  = Number(pop > 60 || (pop > 40 && P(0.75)) || (pop > 20 && b.walls && P(0.4)));
b.temple  = Number((religion && theocracy && P(0.5)) || pop > 50 || (pop > 35 && P(0.75)) || (pop > 20 && P(0.5)));
```
(`pop` here is in FMG's internal units; ×`populationRate` for real people.) Burg *type* (`getType`, L241): `Naval / Lake / Highland (h>60) / River (river length>100 and longest) / Nomadic / Hunting / Generic`.

**Conclusion for your project:** if you beat Watabou's *layout*, you can plug straight into FMG's ecosystem by accepting the same query string — FMG users are the single biggest downstream consumer of MFCG.

---

# 3) WATABOU'S VILLAGE GENERATOR — how it differs

https://watabou.itch.io/village-generator · https://watabou.github.io/village-generator/ (bundle `Village.js`, 1.29 MB, Closure-minified, **closed source**).

⚠️ The itch.io devlogs are **teasers only** — each post body is ~2 sentences ending in a `(more)` link to a paywalled Patreon post. There is no public algorithm write-up. (Verified by fetching raw HTML of `devlog/731413`, `248943`, `308559`, `584696`, `507254`, `736720`, `840277`.)

### 3.1 Structural differences (from URL contract + string extraction of `Village.js`)

| | City Generator (MFCG) | Village Generator |
|---|---|---|
| Size parameter | `size` = **patch count** 6–100 | `width`/`height` in **world units** (400–1600 × w/2.2), non-square canvas |
| Population | `population` (display only) | `pop` **drives density directly** |
| Structure driver | Voronoi patches → wards | **tag list** (declarative constraint set) |
| Enclosure | curtain wall + towers + gates | **palisade** (added 1.6.0, May 2024) — no towers |
| Green space | Park ward | **orchards, groves, thickets, fields, furrows** |
| Roads | A* over patch graph, gate→plaza | `highway / dead end / isolated / crossroads / junction / fork / driveways` |
| Water | (newer MFCG: river/coast/canal/docks) | `pond, river, riverside, estuary, confluence, mouth, wetland, shore, wharf` |

### 3.2 Full tag vocabulary recovered from `Village.js` string table
Settlement scale: `hamlet, village, town, city, district`
Site: `estuary, island, coast, coastal, confluence, river, riverside, mouth, fork, pond, wetland, shore, valley, hill, forest, no_water`
Connectivity: `highway, dead end, isolated, crossroads, junction, driveways, roads, road`
Land use: `farmland, uncultivated, fields, orchards, no orchards, grove, thicket, trees, forest`
Density/form: `sparse, dense, square, squares, no square, organic, plain, proper, marked, minimal, compact`
Buildings/POI: `smithy, tavern, inn, temple, wharf, roadhouse, special_shop, bridge, palisade, planks, plank, prisms`
Render: `shading, shadows, shade_trees, relief, elevation, night, dramatic, lights, palette, paper, sand, ground, water, grammar` (a `"grammar"` string confirms a rule-grammar naming/layout system).

### 3.3 Feature timeline from devlog titles (dates = when each subsystem landed)
`1.2.5 fields (2021-05-01)` → `1.2.7 improved fields and roads (2021-10-28)` → `1.2.8 Procgen Mansion integration (2022-05-18)` → `1.3.0 new trees and buildings (2022-09-08)` → `1.4.0 village square and orchards (2023-03-25)` → `1.5.0 non-square maps and isolated villages (2023-06-05)` → `1.5.1 ponds and improved farm fields (2023-09-04)` → `1.5.2 improved rivers and bridges (2023-09-16)` → `1.5.3 new water features (2023-10-26)` → `1.5.4 spotlight and improved roads (2024-05-14)` → `1.6.0 palisades (2024-05-23)` → `1.6.2 shading (2024-08-21)` → `1.6.4 crossroads and numbered houses (2024-11-26)` → `1.6.5 (2024-12-10)`.

**Takeaway:** the village generator is *road-first + field-first*, not patch-first. Farm fields and the road graph come first, buildings hang off road frontage. MFCG is *cell-first*: Voronoi cells are subdivided into lots.

---

# 4) OTHER OPEN-SOURCE GENERATORS WORTH STEALING FROM

### 4.1 ★ ProbableTrain / MapGenerator — the strongest technical rival
https://github.com/probabletrain/mapgenerator · live https://maps.probabletrain.com · **GPL-3.0 + LGPL-3.0**, TypeScript (98%).
**Approach:** Chen et al., *"Interactive Procedural Street Modeling"* — **tensor-field streamline tracing**, explicitly cited in `src/ts/impl/streamlines.ts` L31.

Files: `impl/tensor.ts`, `impl/basis_field.ts` (grid + radial basis fields with exponential decay), `impl/tensor_field.ts`, `impl/integrator.ts` (Euler **and RK4**), `impl/streamlines.ts` (the seeding/tracing loop), `impl/grid_storage.ts` (uniform spatial hash sized at `dsep`), `impl/graph.ts` (streamlines → planar graph), `impl/polygon_finder.ts` (face extraction), `impl/polygon_util.ts`, `impl/water_generator.ts`, `ui/buildings.ts`, `model_generator.ts` (STL export via three-csg).

**Exact tuned constants (`src/ts/ui/main_gui.ts` L47-95):**
```
minor roads:  dsep 20,  dtest 15,  dstep 1, dlookahead 40,  dcirclejoin 5, joinangle 0.1,
              pathIterations 1000, seedTries 300, simplifyTolerance 0.5, collideEarly 0
major roads:  dsep 100, dtest 30,  dlookahead 200
main roads:   dsep 400, dtest 200, dlookahead 500
coastline:    minor params + pathIterations 10000, simplifyTolerance 10,
              coastNoise{size 30, angle 20}, riverNoise{size 30, angle 20}, riverSize 30
buildings (PolygonParams): maxLength 20, minArea 50, shrinkSpacing 4, chanceNoDivide 0.05
building height: Math.random()*20 + 20
```
Derived in `StreamlineGenerator` ctor: `dtest = min(dtest, dsep)`, `dcollideselfSq = (dcirclejoin/2)²`, `nStreamlineStep = floor(dcirclejoin/dstep)`, `nStreamlineLookBack = 2·nStreamlineStep`; `NEAR_EDGE = 3`.

**Lot subdivision** — `PolygonUtil.subdividePolygon(p, minArea)` (`impl/polygon_util.ts` L80). Direct competitor to Watabou's `createAlleys`:
```ts
area = calcPolygonArea(p);
if (area < 0.5*minArea) return [];
find longestSide + perimeter;
if (area / (perimeter*perimeter) < 0.04) return [];   // shape index: reject slivers, 1:4 rect limit
if (area < 2*minArea) return [p];
deviation = Math.random()*0.2 + 0.4;                  // 0.4..0.6
averagePoint = (longestSide[0] + longestSide[1]) * deviation;   // NB: not a true midpoint
perpVector   = normalize(perp(longestSide diff)) * 100;
bisect = [avg + perp, avg - perp];
sliced = PolyK.Slice(p, ...bisect); recurse on each.
```
Compared with Watabou: no angular jitter, no alley gap, but has an explicit **shape-index rejection** (`A/P² < 0.04`) which Watabou lacks — worth stealing.

**Block/face extraction** — `PolygonFinder.findPolygons()` (L150): for every graph node with `adj.length ≥ 2`, walk clockwise (`recursiveWalk`) until the loop closes; discard faces with `> maxLength (20)` vertices; mark traversed directed edges so each face is found once; then filter by `tensorField.onLand(avg) && !inParks(avg)`.

### 4.2 Flokey82 / go_gens — `gencitymap`, `genvillage`
https://github.com/Flokey82/go_gens — **Apache-2.0**, Go.
`gencitymap/` is an explicit Go port of ProbableTrain (README says so): `tensor.go, tensor_field.go, tensor_integrator.go` (Euler + **RK4**: `k1 + 4·k23 + k4) · dstep/6`), `tensor_streams.go` (same `Dsep/Dtest/Dstep/Dcirclejoin/Dlookahead/Joinangle/PathIterations/SeedTries/SimplifyTolerance/CollideEarly` param struct), `tensor_graph.go`, `tensor_polygon_finder.go`, `util_flatbush.go` (flatbush spatial index instead of grid hash). Also useful: `genarchitecture`, `gengeometry` (`SimplifyPolyline`), `genworldvoronoi`.
`genvillage/` is **not** a layout generator — it's an economic solver: `BuildingType{Requires, Provides}` resource graph + `Solve()` to close supply loops (fishery→worker→grain→flour→bread). Good source of *semantic* building mixes to drive a layout.

### 4.3 phiresky / procedural-cities — Parish & Müller reference implementation
https://github.com/phiresky/procedural-cities · demo `phiresky.github.io/procedural-cities/demo.html` · **AGPL**, TypeScript + a 15-page paper (`paper.md`/`paper.pdf`).
`implementation/src/config.ts` — complete constant set:
```
DEFAULT_SEGMENT_LENGTH 300,  HIGHWAY_SEGMENT_LENGTH 400
DEFAULT_SEGMENT_WIDTH 6,     HIGHWAY_SEGMENT_WIDTH 16
RANDOM_BRANCH_ANGLE   = randomNearCubic(3)    // ±3°, cubic-biased
RANDOM_STRAIGHT_ANGLE = randomNearCubic(15)   // ±15°
DEFAULT_BRANCH_PROBABILITY 0.4,  HIGHWAY_BRANCH_PROBABILITY 0.02
HIGHWAY_BRANCH_POPULATION_THRESHOLD 0.1, NORMAL_BRANCH_POPULATION_THRESHOLD 0.1
NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY 10, HIGHWAY_POPULATION_SAMPLE_SIZE 1
MINIMUM_INTERSECTION_DEVIATION 30 (degrees), SEGMENT_COUNT_LIMIT 7000, ROAD_SNAP_DISTANCE 50
QUADTREE_PARAMS {x:-2e4,y:-2e4,w:4e4,h:4e4}, QUADTREE_MAX_OBJECTS 10, QUADTREE_MAX_LEVELS 10
HEATMAP_PIXEL_DIM 25, TWO_SEGMENTS_INITIALLY true
```
Algorithm: priority-queue segment growth; `globalGoals` proposes continuations/branches sampled toward max population (Perlin heatmap); `localConstraints` snaps to existing intersections within `ROAD_SNAP_DISTANCE` and rejects intersections under `MINIMUM_INTERSECTION_DEVIATION`.

### 4.4 t-mw / citygen-godot — same algorithm, MIT-licensed
https://github.com/t-mw/citygen-godot (GDScript port of https://github.com/t-mw/citygen; write-up at http://tmwhere.com/city_generation.html) — **MIT**. `scripts/city_gen.gd`:
```
segment_count_limit 2000 (exported), BRANCH_ANGLE_DEVIATION 3.0°, STRAIGHT_ANGLE_DEVIATION 15.0°,
MINIMUM_INTERSECTION_DEVIATION 30.0°, DEFAULT_SEGMENT_LENGTH 300, HIGHWAY_SEGMENT_LENGTH 400,
DEFAULT_BRANCH_PROBABILITY 0.4, HIGHWAY_BRANCH_PROBABILITY 0.05,
NORMAL_BRANCH_POPULATION_THRESHOLD 0.5, HIGHWAY_BRANCH_POPULATION_THRESHOLD 0.5,
NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY 5, MAX_SNAP_DISTANCE 50,
BUILDING_SEGMENT_PERIOD 5, BUILDING_COUNT_PER_SEGMENT 10, MAX_BUILDING_DISTANCE_FROM_SEGMENT 400.0
```
**Note the divergence from phiresky:** highway branch probability 0.05 vs 0.02, population thresholds 0.5 vs 0.1, delay 5 vs 10. Buildings are placed *around every 5th segment* rather than in extracted faces.

### 4.5 LAVS-TM / Map-Generation — Python medieval city, MIT
https://github.com/LAVS-TM/Map-Generation — **MIT**, Python + `scipy.spatial.Voronoi` + `shapely`. Closest philosophical clone of Watabou. `src/city.py`:
```python
City(population, density=10000, has_walls, has_castle, has_river)
nb_people_by_districts = 8 + (density // 5000)
nb_regions             = 4 + (population // 5000)
regions = map.generate_regions(nb_regions)
walls   = MultiPolygon(regions).buffer(0.05, join_style=2)     # miter
new_regions, streets = map.split_region(regions, 0.05)          # street width 0.05
nb_houses = population // 40                                    # 40 people per house
city_elements, _ = map.split_region(city_elements, 0.015)       # alley width 0.015
castle = largest polygon among the first len//10 elements
```
`map.generate_regions(N)` (`src/map.py` L26): **jittered square grid**, not a spiral — `points = linspace(-1,1,N)²  * (N-2)`, then `+= uniform(0,1)*(radius/3)`; Voronoi; keep only regions contained in a random `convex_hull(8 pts).buffer(radius/2)` blob (this is the irregular city silhouette). `generate_buildings` (L55) does a *second* Voronoi inside each district on a jittered lattice (`+= uniform*(1/9)`), polygonizes ridges, and unions in the leftover difference. Ward classes exist as `src/downtown/{market,cathedral,church,castle,house,university,mansion,garden,townhall,park,fort,monastry}.py` and `src/countrysides/{farm,field,forest,lake,land}.py`.

### 4.6 Others on GitHub `topics/city-generator` (via https://github.com/topics/city-generator)
`fegennari/3DWorld` (C++, 1.4k★, full 3D procedural city engine), `jeroenvanriel/city-generator` (JS, TU/e), `dasmig/city-generator` (C++23 header-only, demographic-driven), `gabrielboroghina/Procedural-City-Generation` (OpenGL/C++), `hartoman/MultiMapper` (Java), `Beneking102/bene-proggen-maps` (Blender/Python), `iMarv/CityGenerator` (C#), `Lecrapouille/Ecstasy` (Pascal).

---

# 5) SEAN BARRETT — Herringbone Wang Tiles

Index: https://nothings.org/gamedev/herringbone/ · papers https://nothings.org/gamedev/herringbone/herringbone_tiles.html (2011) and https://nothings.org/gamedev/herringbone/more_herringbone_tiles.html (2014) · library https://nothings.org/gamedev/herringbone/herringbone_src.html · source https://github.com/nothings/stb/blob/master/stb_herringbone_wang_tile.h — **public domain / MIT dual (stb)**.

### 5.1 The idea
- Tiles are rectangles with aspect **1:2 and 2:1**; both orientations are used, laid in a **herringbone** (parquet) pattern.
- Each rectangle is treated as **two squares**. Splitting the long edges, every tile has **6 edges** ⇒ herringbone tiling is **isomorphic to hexagonal tiling** ("each rectangle can be seen as a hexagon whose corners are flexed").
- **6 distinct edge-matchup classes** (vs 2 for square Wang tiles, 3 for hex).
- **Tile counts:** Cohen-style (3 constrained edges, 2 colors ⇒ 8 cases) needs **16 horizontal + 16 vertical**. A **"complete stochastic set"** (one tile for every combination of *all six* edge colors) needs **64 horizontal + 64 vertical = 128**. That's what Barrett shipped in his 2010 CRPG. General formula from `stbhw__get_template_info` (`stb_herringbone_wang_tile.h` L430): edge mode `horz_count = (c0·c1·c2·varyX)·(c3·c4·c2·varyY)`, `vert_count = (c0·c5·c1·varyY)·(c3·c4·c5·varyX)`; corner mode `horz_count = (c1·c2·c3·varyX)·(c0·c1·c2·varyY)`, etc.
- **Why a complete stochastic set matters:** a tile choice can never constrain anything beyond its immediate neighbours, so you can (a) pre-place large/unique tiles first and still fill deterministically left-to-right, top-to-bottom, and (b) never dead-end. This is the paper's actual contribution.
- **Connectivity trick:** make each half-square internally fully connected to all its outward edges; the interior edge between the two halves is connected only *sometimes*. This guarantees global connectivity with zero computation, yet produces meandering, non-trivial paths (the 2014 paper traces 5 example loops, each filling a 2×3 or 3×2 region of half-tiles from 5 wang tiles).

### 5.2 The actual layout loop — `stbhw_generate_image()`, `stb_herringbone_wang_tile.h` L692
```c
sidelen = ts->short_side_len;
xmax = (w/sidelen) + 6;  ymax = (h/sidelen) + 6;      // default STB_HBWANG_MAX_X/Y = 100
ypos = -1 * sidelen;
for (j = -1; ypos < h; ++j) {
    int phase = (j & 3);                              // 4-row herringbone period
    i = (phase == 0) ? 0 : phase - 4;                 // horizontal displacement per row
    for (;; i += 4) {                                 // stride 4 short-sides
        int xpos = i * sidelen;
        if (xpos >= w) break;
        /* horizontal (2n × n) tile at (xpos, ypos) */
        t = stbhw__choose_tile(h_tiles, num_h_tiles, <6 color refs>, weighting);
        draw_h_tile(output, xpos, ypos, t, sidelen);
        xpos += sidelen*2;   // skip past this tile
        xpos += sidelen;     // skip the tail of the previous vertical tile
        /* vertical (n × 2n) tile at the new xpos */
        t = stbhw__choose_tile(v_tiles, num_v_tiles, <6 color refs>, weighting);
        draw_v_tile(output, xpos, ypos, t, sidelen);
    }
    ypos += sidelen;
}
```
Corner-color mode indexes `c_color[j+2..j+4][i+2..i+6]`; edge mode mixes `h_color[][]`/`v_color[][]`. **Corner colour type is `p = (i - j + 1) & 3`** — 4 corner classes.

**Tile selection** — `stbhw__choose_tile` (L595): two-pass reservoir. Pass 1 counts (weighted) matches against the 6 partial constraints (`*a < 0` = unconstrained wildcard); `m = rand() % n`; pass 2 re-scans and returns the tile at the weighted index, **writing the chosen tile's colours back into the constraint cells**. `NULL` ⇒ `"couldn't find tile matching constraints"`.

**Repetition reduction** (corner mode, L719, `#ifndef STB_HBWANG_NO_REPITITION_REDUCTION`): scan every 3×2 / 2×3 window; if `stbhw__match(x,y)` (`c_color[y][x] == c_color[y+1][x+1]`) holds across all six, forcibly recolor the centre corner via `stbhw__change_color`.

### 5.3 Does it apply to city layout?
Directly relevant but **not** a drop-in for organic medieval towns:
- **Pro:** Barrett himself proposes it for *Infamous*-style cities: "hexagonal tiles were a poor match for street grids, which are normally rectangular. Since Herringbone Tiles with rotation appear to be somewhat isomorphic to hexagonal tiles, they might support ... streets that have rectangular grids." O(1) per tile, infinite/streaming generation in arbitrary order (Minecraft-style), no global solve.
- **Con:** it is *grid-aligned and authored*. It gives you hand-designed block content and guaranteed street connectivity, but it cannot produce radial street patterns, a curtain wall following a Voronoi hull, or wedge-shaped medieval lots. The realistic use for a fantasy city generator is **hybrid**: use Voronoi/streamline methods for the macro street skeleton and curtain wall, then use herringbone Wang tiles (or the "complete stochastic set" idea) to fill *regular quarters* — a planned grid district, a Roman-grid core, docks, barracks — where authored micro-detail beats procedural subdivision. The `stbhw__choose_tile` wildcard/`-1` mechanism plus the "pre-place large unique tiles first, then fill" property is exactly what you want for placing landmark buildings.

---

# 6) AMIT PATEL / RED BLOB GAMES

### 6.1 mapgen2 — https://github.com/amitp/mapgen2, **MIT** (`Copyright 2010 Amit J Patel`), ActionScript 3
Article: http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/

**`Roads.as` — contour-following road networks (directly reusable for a hinterland road net):**
```as3
elevationThresholds = [0, 0.05, 0.37, 0.64];       // 3 contour bands
// 1. seed: every coast or ocean center gets centerContour = 1; push to BFS queue
// 2. BFS: for each neighbour r of p:
//       newLevel = centerContour[p];
//       while (r.elevation > elevationThresholds[newLevel] && !r.water) newLevel++;
//       if (newLevel < centerContour[r]) { centerContour[r] = newLevel; queue.push(r); }
//    (the !r.water clause "extends the contour line past bodies of water so roads don't terminate inside lakes")
// 3. cornerContour[q] = MIN over adjacent centers
// 4. an edge is a ROAD iff cornerContour[v0] != cornerContour[v1];
//    road[edge] = min(the two levels); roadConnections[center] collects them
```
So roads are exactly the **boundaries between elevation bands** on the Voronoi dual graph — cheap, always connected, always follows terrain. Adaptable to city districts: draw main streets on boundaries between *density* bands rather than elevation bands.

**`NoisyEdges.as` — the single most stealable routine for making a Voronoi city not look like a Voronoi city:**
```as3
static NOISY_LINE_TRADEOFF = 0.5;   // low: jagged Voronoi edge; high: jagged Delaunay edge
// per Voronoi edge, build TWO half-paths (v0→midpoint, v1→midpoint) inside quads
// A=v0, B=lerp(v0,d0,f), C=edge.midpoint, D=lerp(v0,d1,f)
minLength = 10;                                   // default recursion floor
if (d0.biome != d1.biome) minLength = 3;
if (d0.ocean && d1.ocean)  minLength = 100;
if (d0.coast || d1.coast)  minLength = 1;
if (edge.river || lava)    minLength = 1;

subdivide(A,B,C,D):
  if (|A-C| < minLength || |B-D| < minLength) return;
  p = rand(0.2, 0.8);  q = rand(0.2, 0.8);
  E = lerp(A,D,p); F = lerp(B,C,p); G = lerp(A,B,q); I = lerp(D,C,q);
  H = lerp(E,F,q);                                    // the displaced midpoint
  s = 1 - rand(-0.4, +0.4);   t = 1 - rand(-0.4, +0.4);
  subdivide(A, lerp(G,B,s), H, lerp(E,D,t));  points.push(H);
  subdivide(H, lerp(F,C,s), C, lerp(I,D,t));
```
Recursive quadrilateral midpoint displacement constrained to stay inside the Voronoi/Delaunay quad ⇒ jagged but **non-self-intersecting and shared between both adjacent cells** (no cracks). Apply this to ward boundaries / walls / river banks. `minLength` per-edge-type is the whole art: 100 for open water (straight), 1 for coasts (very jagged).

Other files: `Lava.as`, `Watersheds.as`, `RoadsSpanningTree.as`, `Map.as`, `graph/{Center,Corner,Edge}.as`, `prototypes/noisy_line.as`.

### 6.2 Voronoi maps tutorial — https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/
- Points: **jittered grid**, `jitter = 0.5`, `x + jitter*(random() - random())` (triangular distribution). Amit explicitly notes "could be better (using either poisson disk or relaxation)".
- Triangulation: **Delaunator** (`Delaunator.from(points, l=>l.x, l=>l.y)`), then Voronoi from `halfedges`/`triangles`/`centers`, using **centroids rather than circumcenters** (avoids degenerate spikes — relevant if you want tamer patch shapes than Watabou's raw circumcenters).
- Elevation/moisture from multi-octave Simplex (wavelength 0.5); biomes via Whittaker table; rivers by `downslope` + accumulated upstream moisture with a render threshold.
- Companion: `mapgen4` https://www.redblobgames.com/maps/mapgen4/, `mapgen2` https://www.redblobgames.com/maps/mapgen2/, dual-mesh library (Apache-2.0), terrain-from-noise https://www.redblobgames.com/maps/terrain-from-noise/, A* https://www.redblobgames.com/pathfinding/a-star/introduction.html (Watabou's `Graph.aStar` is a degraded Dijkstra — Amit's page is the reference for doing it properly).

---

## Licensing summary (for "can I copy this?")

| Project | License | Copy code? |
|---|---|---|
| watabou/TownGeneratorOS | **GPL-3.0** | No (unless you also GPL) — but **algorithms/constants are not copyrightable**; reimplement |
| Watabou live MFCG / Village Generator | closed | No |
| Azgaar/Fantasy-Map-Generator | **MIT** | Yes |
| ProbableTrain/MapGenerator | GPL-3.0 + LGPL-3.0 | LGPL parts linkable; GPL parts viral |
| Flokey82/go_gens | **Apache-2.0** | Yes |
| phiresky/procedural-cities | **AGPL** | Avoid for SaaS |
| t-mw/citygen-godot | **MIT** | Yes |
| LAVS-TM/Map-Generation | **MIT** | Yes |
| nothings/stb (herringbone) | **Public domain / MIT** | Yes |
| amitp/mapgen2 | **MIT** | Yes |

## Local checkouts (for follow-up work)
`/home/claude/TownGeneratorOS` · `/home/claude/FMG199` (Azgaar v1.99) · `/home/claude/FMG` (Azgaar current) · `/home/claude/mapgen` (ProbableTrain) · `/home/claude/mapgen2` (Amit) · `/home/claude/pcities` (phiresky) · `/home/claude/citygen` (t-mw) · `/home/claude/lavs` (LAVS-TM) · `/home/claude/gogens` (go_gens, sparse) · `/tmp/mfcg.js`, `/tmp/vgen.js` (Watabou minified bundles) · `/tmp/stb_hb.h`.

**Note:** `WebSearch` hit its 200-call session budget partway through (before I used it even once), so all discovery was done via `git clone`, `curl`, and `WebFetch` against known/derived URLs. GitHub's REST API is blocked in this sandbox (403 "use add_repo"), but `git clone` and `raw.githubusercontent.com` work.

Sources: [TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) · [MFCG live](https://watabou.github.io/city-generator/) · [Village Generator](https://watabou.itch.io/village-generator) · [Village devlogs](https://watabou.itch.io/village-generator/devlog) · [Azgaar FMG](https://github.com/Azgaar/Fantasy-Map-Generator) · [ProbableTrain MapGenerator](https://github.com/probabletrain/mapgenerator) · [go_gens](https://github.com/Flokey82/go_gens) · [phiresky/procedural-cities](https://github.com/phiresky/procedural-cities) · [citygen-godot](https://github.com/t-mw/citygen-godot) · [tmwhere city generation](http://tmwhere.com/city_generation.html) · [LAVS-TM/Map-Generation](https://github.com/LAVS-TM/Map-Generation) · [github topics/city-generator](https://github.com/topics/city-generator) · [Herringbone Wang Tiles](https://nothings.org/gamedev/herringbone/) · [stb_herringbone_wang_tile.h](https://github.com/nothings/stb/blob/master/stb_herringbone_wang_tile.h) · [amitp/mapgen2](https://github.com/amitp/mapgen2) · [Red Blob Games](https://www.redblobgames.com/) · [Voronoi maps tutorial](https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/)

agentId: ad4307ed7ff38c9b9 (use SendMessage with to: 'ad4307ed7ff38c9b9', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 213523
tool_uses: 95
duration_ms: 990353</usage>

---

<!-- fuente: city-generation.md -->

I have the complete ground truth. Writing up now.

---

# Procedurally Generating an MFCG-Grade Medieval City — Implementation Report

**Primary source: the actual Haxe source, cloned and read line-by-line** from [github.com/watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) (GPL-3.0 — algorithms and constants are not copyrightable; reimplement, don't copy text). Everything marked **[OS]** is verbatim from that code. Everything marked **[MFCG]** is from the current closed build, recovered from [watabou.github.io/city-generator/mfcg.js](https://watabou.github.io/city-generator/mfcg.js) (minified but retains class names, string literals and `.hx` metadata) and the [itch.io devlogs](https://watabou.itch.io/medieval-fantasy-city-generator/devlog).

---

## 0. The one architectural decision you must make first

**[OS] The entire algorithm depends on Voronoi cell vertices being *shared mutable `Point` objects*.** `Patch.fromRegion` stores `tr.c` — the circumcenter `Point` of a `Triangle`, and the *same* `Triangle` instance appears in every adjacent region's vertex list. So `Polygon.contains(v)` is `indexOf(v) != -1` — **reference identity, not geometric containment**. That identity *is* the topology:

- `optimizeJunctions` does `v0.addEq(v1); v0.scaleEq(0.5)` — moving a junction for every patch at once.
- `CurtainWall` does `shape.set([...smoothed])` → `this[i].set(p[i])` — smoothing the wall physically drags the patch vertices with it.
- `Topology` maps `Point → Node` in a `Map<Point,Node>` keyed by identity.
- `Model.findCircumference` finds the union outline by looking for directed edges `(a,b)` with no reverse twin `(b,a)`.

In TypeScript, **do not** try to reproduce this with object identity plus `Array.indexOf` (O(n) scans everywhere, and `Point` equality becomes a footgun). Use an explicit indexed mesh:

```ts
interface Mesh {
  vx: Float64Array; vy: Float64Array;          // vertex positions, index = vertex id
  patchVerts: number[][];                      // patch -> CCW vertex ids
  vertPatches: number[][];                     // vertex -> incident patch ids
  edgeType: Map<number, EdgeKind>;             // key = (min<<20)|max, kind = WALL|COAST|ROAD|CANAL|NONE
}
```
Moving a vertex = writing `vx[i]`. Shared-topology semantics come free, `contains` is O(1), and you get the edge-tagging that **[MFCG]** later needs (§7). This is the single highest-value deviation from the original.

---

## 1. Point / patch generation

### 1.1 The seeding spiral **[OS]** — `Model.buildPatches`

```haxe
var sa = Random.float() * 2 * Math.PI;
var points = [for (i in 0...nPatches * 8) {
    var a = sa + Math.sqrt(i) * 5;
    var r = (i == 0 ? 0 : 10 + i * (2 + Random.float()));
    new Point(Math.cos(a) * r, Math.sin(a) * r);
}];
```

Exactly `8 × nPatches` seeds. **Not** Poisson, **not** blue noise, **not** jittered grid.

**Why it works — I verified this analytically and numerically.** With `E[2 + rand] = 2.5`, `r(i) ≈ 10 + 2.5i` and `a(i) = a₀ + 5√i`:

| | formula | at i=40 | i=100 | i=300 |
|---|---|---|---|---|
| along-arm spacing `r·da/di` | `2.5i · 5/(2√i) = 6.25√i` | 43.5 | 65.0 | 109.7 |
| adjacent-arm separation `2.5·Δi_turn`, `Δi_turn ≈ 2.51√i` | `6.28√i` | 43.7 | 66.8 | 112.8 |
| **ratio** | **≈ 1.00** | 1.00 | 0.97 | 0.97 |

The spiral is **quasi-isotropic**: local cell size ≈ `6.25√i ≈ 4√r`. Cells are small at the centre and grow as the *square root* of radius. That single property is why MFCG maps have a dense core and coarse outskirts without any density function. Replicate the formula exactly; do not "improve" it with Poisson sampling or you lose the gradient.

Resulting extents (measured): `nPatches=15` → 120 seeds, `rMax ≈ 340`; `nPatches=40` → 320 seeds, `rMax ≈ 910`.

### 1.2 Sizes **[OS]** (`TownScene`, `StateManager`)

| Label | nPatches |
|---|---|
| Small Town | 6–10 |
| Large Town | 10–15 |
| Small City | 15–24 |
| Large City | 24–40 |
| Metropolis | ≥40 |

Default 15. URL clamp `6 ≤ size ≤ 40`.

**[MFCG]** current: `small {10,20}`, `medium {20,40}`, `large {40,80}`, custom `5…200`, default 25. Devlog [0.10.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha): *"Medium cities are made of 20-40 patches instead of 12-25 as before."*

**Scale anchor [MFCG]:** 1 map unit = **4 metres** (JSON export `SCALE=4`; `roadWidth: 8` for `MAIN_STREET = 2.0`). So `MAIN_STREET` = 8 m, `REGULAR_STREET` = 4 m, `ALLEY` = 2.4 m, tower radius 1.8 u = 7.2 m. Use this to sanity-check every constant below.

### 1.3 Voronoi **[OS]**

Bowyer–Watson incremental Delaunay (`Voronoi.hx`), regions = circumcenters of incident triangles, sorted CCW by angle about the seed. A bounding frame of **4 corner points** is inserted first at `[minx − dx/2, miny − dy/2, maxx + dx/2, maxy + dy/2]` where `dx,dy` are half the point-cloud extents. `partioning()` returns only regions none of whose triangles touch a frame point — i.e. it **drops the convex-hull ring of seeds**.

**[MFCG]** replaced this with a port of [Delaunator](https://github.com/mapbox/delaunator) in 0.7.3. Do the same — use `delaunator` from npm, build the dual yourself.

### 1.4 Lloyd relaxation — **this is broken in the original; fix it**

```haxe
for (i in 0...3) {
    var toRelax = [for (j in 0...3) voronoi.points[j]];
    toRelax.push( voronoi.points[nPatches] );
    voronoi = Voronoi.relax( voronoi, toRelax );
}
```

`voronoi.points[0..3]` are the **four frame corners**, not city seeds. `Voronoi.relax` only relaxes points that are seeds of *real* regions, and frame points never are. So `points[0],[1],[2]` are no-ops, and `points[nPatches]` is actually seed index `nPatches − 4`. **The comment says "Relaxing central wards"; the code relaxes exactly one non-central point, three times.** It is effectively a no-op.

For TypeScript: either drop it entirely (**[MFCG]** did) or do it properly — 1–2 Lloyd iterations over seeds `0…nPatches` only. Note **[MFCG]** instead *hard-codes the plaza*: seeds 1–4 are overwritten with a rectangle `polar(f,a₀), polar(h,a₀+π/2), polar(f,a₀+π), polar(h,a₀+3π/2)`, `f = 8+8·rnd`, `h = f(1+rnd)` — that's what forces the central plaza to be roughly rectangular. **Steal this; it's better than relaxation.**

Also consider Amit Patel's fix: build cells from **centroids rather than circumcenters** ([redblobgames Voronoi tutorial](https://www.redblobgames.com/x/2022-voronoi-maps-tutorial/)) — eliminates the degenerate spikes that cause Watabou's `"Bad citadel shape!"` retries.

### 1.5 Inner-city selection **[OS]**

```haxe
voronoi.points.sort((p1,p2) -> sign(p1.length - p2.length));  // by |p| from origin
var regions = voronoi.partioning();                            // iterates points in that order
count = 0;
for (r in regions) {
    patch = Patch.fromRegion(r); patches.push(patch);
    if (count == 0) {
        center = patch.shape.min(p -> p.length);   // ← a VERTEX, not the centroid
        if (plazaNeeded) plaza = patch;
    } else if (count == nPatches && citadelNeeded) {
        citadel = patch; citadel.withinCity = true;
    }
    if (count < nPatches) { patch.withinCity = true; patch.withinWalls = wallsNeeded; inner.push(patch); }
    count++;
}
```

- `inner` = the `nPatches` regions **closest to the origin**. Because `r(i)` is monotonic in `i`, sorting is nearly a no-op — it just cleans up the `(2+rand)` jitter.
- **`center` is a vertex of patch 0**, deliberately: it must be a node in the street graph so A* can target it.
- The citadel is region index `nPatches` — the first patch *outside* the inner ring, so the castle sits tangent to the wall. This matches real urban castles ([Urban castle](https://en.wikipedia.org/wiki/Urban_castle)).
- `plazaNeeded`, `citadelNeeded`, `wallsNeeded` are three independent 50% coin flips.

**[MFCG]** probabilities are now size-driven: `walls = (s+30)/80`, `citadel = 0.5 + s/100`, `plaza = 0.9`, `temple = s/18`, `river = 2/3`, `coast = 0.5`, `shanty = s/80`.

### 1.6 Junction cleanup **[OS]** — `optimizeJunctions`

Merge any two consecutive vertices of an inner/citadel patch closer than **8 world units** (= 32 m): rewrite `v1 → v0` in every other patch that shares `v1`, set `v0 = (v0+v1)/2`, remove `v1`. Then dedupe. This kills the micro-edges Voronoi always produces and is what makes street junctions read as junctions.

**[MFCG]** threshold is now `max(3·LTOWER_RADIUS, perimeter/n/3)` = `max(7.5, …)`.

---

## 2. Walls

### 2.1 The wall polygon **[OS]** — `Model.findCircumference`

Union outline of the inner patches, found combinatorially, not geometrically:

```ts
function findCircumference(wards: Patch[]): Polygon {
  if (!wards.length) return [];
  if (wards.length === 1) return wards[0].shape.slice();
  const A: V[] = [], B: V[] = [];
  for (const w1 of wards)
    forEdge(w1.shape, (a, b) => {
      // an edge is on the outline iff NO other ward has the reverse edge (b,a)
      if (!wards.some(w2 => findEdge(w2.shape, b, a) !== -1)) { A.push(a); B.push(b); }
    });
  const result: V[] = []; let idx = 0;
  do { result.push(A[idx]); idx = A.indexOf(B[idx]); } while (idx !== 0);
  return result;
}
```
All patches CCW ⇒ every interior edge appears twice with opposite direction. Boundary edges appear once. Chain them by `A[next] === B[cur]`. **O(n²) as written — index edges in a hash map keyed `(a,b)` for O(n).**

### 2.2 Wall smoothing **[OS]**

```haxe
var smoothFactor = Math.min(1, 40 / patches.length);
shape.set([for (v in shape) reserved.contains(v) ? v : shape.smoothVertex(v, smoothFactor)]);
```
with `smoothVertex(v, f) = (prev + v·f + next) / (2 + f)`.

`f = 1` for ≤40 inner patches (maximal smoothing: `(prev+v+next)/3`); less smoothing for bigger cities. `reserved` = the citadel's vertices, which are pinned. **This mutates shared `Point`s, so the wall smoothing drags the adjacent patches' geometry with it** — that's why walls never cut through wards.

### 2.3 Gates **[OS]** — `CurtainWall.buildGates`

Candidate entrances = wall vertices that are **not reserved** and are **shared by more than one inner patch** (`patches.count(p => p.shape.contains(v)) > 1`). Rationale from the source comment: *"so that a street could connect it to the city center."* If a wall has a single patch, all non-reserved vertices qualify.

```
if entrances.length == 0: throw "Bad walled area shape!"   // regenerate whole city
do {
    index = randInt(0, entrances.length)
    gate  = entrances[index]; gates.push(gate)
    ... (outer-patch split, below) ...
    // remove the gate AND its two neighbours so gates can't be adjacent
    if (index == 0)                      { entrances.splice(0,2); entrances.pop(); }
    else if (index == entrances.length-1){ entrances.splice(index-1,2); entrances.shift(); }
    else                                 { entrances.splice(index-1,3); }
} while (entrances.length >= 3)
```
⇒ **gate count ≈ ⌊|entrances| / 3⌋**, and no two gates are within 2 wall vertices of each other.

**Outer-patch split (important, easy to miss):** if the gate has exactly *one* patch outside the walls and that patch has >3 vertices, the outer patch is **split in two** along `gate → farthest`, where

```haxe
wall = shape.next(gate) − shape.prev(gate);
out  = new Point(wall.y, −wall.x);                  // outward normal
farthest = outer.shape.max(v =>
    (shape.contains(v) || reserved.contains(v)) ? −∞
    : dot(v − gate, out) / |v − gate|);             // most outward-facing direction
```
Without this, a road leaving the gate would have no vertex to route through. `Polygon.split(p1,p2)` slices the vertex ring at two indices.

Finally each gate is smoothed once more: `gate.set(shape.smoothVertex(gate))`.

**[MFCG]** adds explicit control: `gates=N` for exact count, `gates=0` for gateless, `hub=1` for one gate per wall vertex; default count `2 + floor(nInner/12 · (coast ? 0.75 : 1))`, chosen by weighted random with a circular-distance repulsion `n[h] *= (d<=1 ? 0 : d-1)`.

### 2.4 Towers **[OS]**

```haxe
for (i in 0...len) {
    var t = shape[i];
    if (!gates.contains(t) && (segments[(i+len-1)%len] || segments[i])) towers.push(t);
}
```
**Every non-gate wall vertex is a tower.** `segments[]` is an all-`true` array in the OS build — the flag exists so **[MFCG]** can delete wall runs along the shore (devlog [0.4.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/4923/040-coastal-cities): *"The section of the city wall which borders the water is removed to provide the city access to the shore"*). Implement `segments: boolean[]` from day one.

Reality check for tuning ([Ávila](https://en.wikipedia.org/wiki/Walls_of_%C3%81vila) 88 towers / 2516 m = 28.6 m; [York](https://en.wikipedia.org/wiki/York_city_walls) 87 m; [Nuremberg](https://en.wikipedia.org/wiki/City_walls_of_Nuremberg) ~38 m): **tower spacing 30–60 m**, gate spacing **250–350 m** dense or **700–850 m** for the English 4-bar pattern. At 4 m/unit, Watabou's wall vertices land naturally in that band for mid-size cities.

### 2.5 The citadel wall **[OS]** — `Castle`

```haxe
wall = new CurtainWall(true, model, [patch],
    patch.shape.filter(v => model.patchByVertex(v).some(p => !p.withinCity)));
```
A one-patch curtain wall whose `reserved` set is *every citadel vertex touching a non-city patch*. Since reserved vertices can't be gates, **the castle's gates all face into the city**. Then `citadel.shape.compactness < 0.75` ⇒ `throw "Bad citadel shape!"` ⇒ full regeneration. (`compactness = 4π·area/perimeter²`: circle 1.00, square 0.79, triangle 0.60.)

Real urban castles have **exactly two** gates — one to the fields, one to the town. Add that.

### 2.6 No-wall cities **[OS]**

`border = new CurtainWall(false, ...)` is still constructed — you always need the outline and gates for street routing. What changes when `wallsNeeded == false`:

| | walled | unwalled |
|---|---|---|
| `model.wall` | `= border` | `null` |
| `patch.withinWalls` | `true` | `false` |
| smoothing / gate smoothing | applied | skipped |
| towers | built | none |
| outer-patch split at gates | done | skipped |
| block inset (`getCityBlock`) | `MAIN_STREET/2` on wall edges | n/a |
| GateWard probability | 0.5 | **0.2** |
| outskirts pass | runs | skipped |
| `isEnclosed(p)` | `withinWalls` ⇒ true | needs *all* neighbours in-city |

That last row is the visual payoff: unwalled cities get `filterOutskirts()` applied to far more wards, so they fade into the countryside instead of stopping at a line. Devlog [0.3.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/3091/030-wall-less-layouts-city-outskirts-smooth-roads).

Also: after walls, `patches = patches.filter(p => p.shape.distance(center) < border.getRadius() * 3)` — the world is culled to 3× the wall radius.

---

## 3. Streets

### 3.1 The topology graph **[OS]** — `Topology.hx`

- **Nodes = patch polygon vertices** (deduped by identity).
- **Edges = patch polygon edges**, cost = **Euclidean length**. Nothing else. No turn penalty, no terrain.
- `blocked` = `citadel.shape ∪ wall.shape` **minus** `gates`. Blocked points get `processPoint → null`, so they're registered in the maps but never linked ⇒ **streets cannot run along or through a wall except at a gate.**
- Two node sets partition the graph: `inner` (vertices of in-city patches) and `outer` (vertices of countryside patches), both **excluding vertices on `border.shape`** — so border vertices belong to neither and act as the permeable seam.

### 3.2 Routing **[OS]** — `Model.buildStreets`

```haxe
for (gate in gates) {
    end = plaza != null ? plaza.shape.min(v => dist(v, gate))   // nearest plaza corner
                        : center;                                // the central vertex
    street = topology.buildPath(gate, end, topology.outer);      // EXCLUDE outer nodes
    if (street == null) throw "Unable to build a street!";
    streets.push(street);

    if (border.gates.contains(gate)) {                            // not castle gates
        dir   = gate.norm(1000);                                  // 1000 units radially outward
        start = argmin over topology.node2pt of dist(p, dir);     // nearest node to that far point
        road  = topology.buildPath(start, gate, topology.inner);   // EXCLUDE inner nodes
        if (road != null) roads.push(road);
    }
}
```
The exclusion sets are the whole trick: **streets are forced to stay inside the city, roads are forced to stay outside.** `exclude` is passed as A*'s pre-seeded closed set.

**`Graph.aStar` is not A\*** — it's Dijkstra with `openSet.shift()` (FIFO, no priority queue, no heuristic), and it never re-opens closed nodes. Replace with a real binary-heap A* using Euclidean `h`. Also note `buildPath` returns the path **goal→start** (`buildPath` pushes ancestors), so gate-to-plaza streets come back reversed — irrelevant after `tidyUpRoads`, but relevant if you keep ordered paths.

### 3.3 Deduplication into arteries **[OS]** — `tidyUpRoads`

```
segments = []
for each street and road:
    for each consecutive (v0,v1):
        if plaza != null and plaza.shape.contains(v0) and plaza.shape.contains(v1): continue  // no street along the plaza rim
        if no existing seg with (start==v0 && end==v1): segments.push(Segment(v0,v1))

arteries = []
while segments not empty:
    seg = segments.pop()
    attach to an artery whose head == seg.end (unshift start) or whose tail == seg.start (push end)
    else start a new artery [seg.start, seg.end]
```
Result: maximal non-duplicated polylines. **Note the greedy single-pass join never merges two arteries that later become joinable** — a real weld pass (join arteries whose endpoints coincide, repeat to fixpoint) gives visibly better long streets.

### 3.4 Smoothing **[OS]**

```haxe
for (a in arteries) {
    var smoothed = a.smoothVertexEq(3);
    for (i in 1...a.length-1) a[i].set(smoothed[i]);   // endpoints PINNED
}
```
`smoothVertexEq(f)` = `v'ᵢ = (vᵢ₋₁ + f·vᵢ + vᵢ₊₁)/(2+f)`, so with `f = 3`: **`v'ᵢ = (vᵢ₋₁ + 3vᵢ + vᵢ₊₁)/5`**, one pass. Because it writes into the shared `Point`s, **smoothing a street also deforms every patch that touches it** — the wards bend around the street. This is essential to the look; do not smooth a copy.

Rendering uses `Spline.curvature = 0.1` for quadratic control points:
```
startCurve(p0,p1,p2): control = p1 − 0.1·(p2−p0)
midCurve(p0,p1,p2,p3): p1a = p1 + 0.1·(p2−p0);  p2a = p2 − 0.1·(p3−p1);  p12 = (p1a+p2a)/2
endCurve(p0,p1,p2):   control = p1 + 0.1·(p2−p0)
```
**[MFCG]** now uses Chaikin (`smoothOpen`) instead.

### 3.5 Widths **[OS]** — `Ward.hx`

```haxe
MAIN_STREET = 2.0;   REGULAR_STREET = 1.0;   ALLEY = 0.6;   // = 8 m / 4 m / 2.4 m
```

**Streets are never rendered as polygons.** They are (a) stroked polylines for `roads`, and (b) — for everything inside the city — **negative space produced by insetting each ward by half the street width** (§5.1). That's the key idea: you don't widen a centreline into a ribbon, you shrink the blocks away from it. Guarantees no self-intersection, no overlap, and correct junction geometry for free.

`drawRoad` renders roads as **two overlaid strokes** — width `MAIN_STREET + 0.3 = 2.3` in `medium`, then `MAIN_STREET − 0.3 = 1.7` in `paper` — producing a paper-coloured ribbon with a thin casing.

For reference against reality ([Designing Buildings](https://www.designingbuildings.co.uk/wiki/The%20history%20of%20the%20dimensions%20and%20design%20of%20roads,%20streets%20and%20carriageways), bastide data): market street 15–23 m, main 6–10 m, secondary 5–6 m, *venelle* 1–3 m, *androne* firebreak 0.25–0.40 m. Watabou's 8/4/2.4 m sits right.

---

## 4. Wards

### 4.1 The deck **[OS]** — `Model.WARDS`, 36 entries

`CraftsmenWard ×21, Slum ×5, MerchantWard ×2, PatriciateWard ×2, Market ×2, Cathedral ×1, AdministrationWard ×1, MilitaryWard ×1, Park ×1`

Shuffled by only `⌊36/10⌋ = 3` adjacent swaps (`wards[i] ↔ wards[i+1]`), then consumed with `shift()`. **Once the deck runs out, every remaining patch becomes `Slum`** — so cities above ~36 patches are mostly slum. Fix this: use a weighted multinomial with per-type caps, or **[MFCG]**'s district approach (§4.5).

### 4.2 Assignment loop **[OS]** — `createWards`

```
unassigned = inner.copy()
if plaza:  plaza.ward = Market;  unassigned.remove(plaza)

// gate wards first
for gate in border.gates:
  for patch in patchByVertex(gate):
    if patch.withinCity && patch.ward == null && Random.bool(wall == null ? 0.2 : 0.5):
        patch.ward = GateWard; unassigned.remove(patch)

while unassigned:
    wardClass = deck.shift() ?? Slum
    rate = static rateLocation on wardClass
    bestPatch = rate == null ? random unassigned patch
                             : argmin over unassigned of rate(model, patch)   // LOWEST wins
    bestPatch.ward = new wardClass(...); unassigned.remove(bestPatch)
```

**Haxe statics are not inherited**, so `Reflect.field(cls,"rateLocation")` returns `null` for `CraftsmenWard`, `GateWard`, `Park`, `Farm`, `CommonWard`. **Those get uniformly random patches.** Only these score (minimum wins):

| Ward | `rateLocation(model, patch)` |
|---|---|
| Merchant | `dist(patch, plaza.center ?? center)` — hug the centre |
| Slum | `−dist(patch, plaza.center ?? center)` — maximise distance |
| Administration | `borders(plaza) ? 0 : dist(patch, plaza.center)` |
| Cathedral | `borders(plaza) ? −1/area : dist(patch, plaza.center) · area` |
| Market | `+∞` if adjacent to another Market; else `area / plaza.area` |
| Military | `0` if borders citadel; `1` if borders wall; else `+∞` (`0` if neither exists) |
| Patriciate | `Σ neighbours: −1 per Park, +1 per Slum` |

**Bug you must not port:** `Polygon.distance(p)` never updates its accumulator —

```haxe
public function distance( p:Point ):Float {
    var v0 = this[0];
    var d = Point.distance( v0, p );
    for (i in 1...this.length) {
        var v1 = this[i];
        var d1 = Point.distance( v1, p );
        if (d1 < d) v0 = v1;      // ← updates v0 but NOT d
    }
    return d;                     // ← always distance from vertex[0]
}
```
It returns the distance to the polygon's **first vertex**, not the minimum. Every distance-based `rateLocation` above is therefore substantially noisier than intended. Fix it (`d = d1`) and the Merchant/Slum radial sorting becomes visibly cleaner.

### 4.3 Ward constructor parameters **[OS]** (`r ≡ Random.float()`, fresh draw per occurrence)

| Ward | `minSq` | `gridChaos` | `sizeChaos` | `emptyProb` |
|---|---|---|---|---|
| Craftsmen | `10 + 80·r·r` | `0.5 + 0.2r` | 0.60 | 0.04 |
| Merchant | `50 + 60·r·r` | `0.5 + 0.3r` | 0.70 | **0.15** |
| Patriciate | `80 + 30·r·r` | `0.5 + 0.3r` | 0.80 | **0.20** |
| Administration | `80 + 30·r·r` | `0.1 + 0.3r` | 0.30 | 0.04 |
| Slum | `10 + 30·r·r` | `0.6 + 0.4r` | 0.80 | 0.03 |
| Gate | `10 + 50·r·r` | `0.5 + 0.3r` | 0.70 | 0.04 |
| Military | `√(block.area)·(1+r)` | `0.1 + 0.3r` | 0.30 | **0.25** |

`r·r` (product of two independent uniforms) is deliberate — it biases hard toward the low end, so most Craftsmen wards have `minSq ≈ 10–25` (small houses) with a long tail to 90. Note `Military` derives `minSq` from the block itself, giving a handful of big barracks blocks regardless of ward size.

Non-`CommonWard` wards:

- **Cathedral**: `Random.bool(0.4) ? Cutter.ring(block, 2 + 4r) : createOrthoBuilding(block, 50, 0.8)`
- **Park**: `block.compactness ≥ 0.7 ? Cutter.radial(block, null, ALLEY) : Cutter.semiRadial(block, null, ALLEY)`
- **Market**: statue with p=0.6 (a `rect(1+r, 1+r)` rotated to the longest edge) else a 16-gon `circle(1+r)`; offset if statue or `Random.bool(0.3)`, to `interpolate(centroid, midpoint(longest edge), 0.2 + 0.4r)`, else centroid.
- **Castle**: `patch.shape.shrinkEq(MAIN_STREET*2 = 4)` then `createOrthoBuilding(block, √(block.area)·4, 0.6)`
- **Farm**: a `rect(4,4)` placed at `interpolate(random vertex, centroid, 0.3 + 0.4r)`, rotated `r·π`, then `createOrthoBuilding(housing, 8, 0.5)`

### 4.4 Countryside **[OS]**

```haxe
cityRadius = max |v| over all vertices of all withinCity patches
for patch in patches where !withinCity && ward == null:
    ward = (Random.bool(0.2) && patch.shape.compactness >= 0.7) ? Farm : Ward   // Ward = empty
```
Plus the outskirts pass: for each wall gate, with probability `1 − 1/(nPatches−5)`, every ward-less patch at that gate is promoted to `withinCity` + `GateWard`. That's the only suburb mechanism in the OS build.

### 4.5 **[MFCG]** — the taxonomy was deleted

The socio-economic wards are **gone**. String-scanning `mfcg.js` finds zero hits for `Slum`, `Craftsmen`, `Merchant`, `Patriciate`, `Military`, `Administration`. Current ward classes: `Alleys` (the single generic urban ward), `Castle`, `Cathedral`, `Market`, `Park`, `Harbour`, `Farm`, `Wilderness`, `WardGroup`. Only three return a hard label; everything else returns `patch.district.name`.

Semantics moved up to a **`DistrictType` enum**: `CENTER | CASTLE | DOCKS | BRIDGE | GATE | BANK | PARK | SPRAWL | REGULAR`. `DistrictBuilder` seeds one district per prominent feature (citadel gate, plaza, each park, each wall gate, each bridge, two river-side cells, first landing cell), tops up randomly to `floor(√nCityCells)` districts, then flood-grows each with a per-type rate (`CASTLE/BRIDGE/GATE = 0.1`, `BANK = 0.5`, else `1.0`), **refusing to cross `WALL` or `CANAL` edges** and damping `0.9` across `ROAD` edges. Devlog [0.7.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/85275/070-districts).

Per-district shape parameters (this is what makes districts look different):
```
minSq       = 15 + 40·|avg4(r)·2 − 1|    → [15, 55)
gridChaos   = 0.2 + avg3(r)·0.8          → [0.2, 1.0)
sizeChaos   = 0.4 + avg3(r)·0.6          → [0.4, 1.0)
shapeFactor = 0.25 + avg3(r)·2           → [0.25, 2.25)
inset       = 0.6·(1 − |avg4(r)·2 − 1|)  → [0, 0.6]
blockSize   = 4 + 10·avg3(r)             → [4, 14)
minFront    = √minSq
greenery    = avg3(r)^(type==PARK ? 1 : 2)
if SPRAWL:  gridChaos *= 0.5;  blockSize *= 2;  greenery = (1+greenery)/2
```

**Recommendation:** implement the district layer. Keep the OS ward *names* as flavour labels driven by district type + distance-to-centre, but drive *geometry* from per-district parameters. You get MFCG's look and D&D-usable labels.

---

## 5. Building subdivision

### 5.1 Ward → block **[OS]** — `Ward.getCityBlock`

```haxe
insetDist = [];
innerPatch = (model.wall == null || patch.withinWalls);
patch.shape.forEdge((v0, v1) -> {
    if (model.wall != null && model.wall.bordersBy(patch, v0, v1))
        insetDist.push(MAIN_STREET / 2);                      // 1.0 — clear of the wall
    else {
        onStreet = innerPatch && plaza != null && plaza.shape.findEdge(v1, v0) != -1;
        if (!onStreet)
            onStreet = arteries.some(s => s.contains(v0) && s.contains(v1));
        insetDist.push((onStreet ? MAIN_STREET : (innerPatch ? REGULAR_STREET : ALLEY)) / 2);
    }
});
return patch.shape.isConvex() ? patch.shape.shrink(insetDist)
                              : patch.shape.buffer(insetDist);
```

Per-edge inset, half the street width: **1.0** on wall / artery / plaza-facing edges, **0.5** on other inner edges, **0.3** outside. Two adjacent patches each inset by half ⇒ the gap between them *is* the street. Note the reversed-edge lookup `plaza.shape.findEdge(v1, v0)` — the plaza's edge runs the other way from the neighbour's.

`isConvex()` picks the cheap `shrink` (half-plane clipping) and falls back to `buffer` (offset + self-intersection resolution) for concave blocks. See §6.

### 5.2 `Ward.createAlleys` — the recursive subdivider **[OS]**

```
createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb = 0.04, split = true) -> Polygon[]:

  1. v ← start vertex of the LONGEST edge of p
  2. spread ← 0.8 · gridChaos
     ratio  ← (1 − spread)/2 + rand()·spread              // centred on 0.5, width 0.8·gridChaos
  3. angleSpread ← (π/6) · gridChaos · (p.area < minSq·4 ? 0 : 1)   // small blocks stay rectangular
     b ← (rand() − 0.5) · angleSpread                     // cut-angle jitter, ±15° max
  4. halves ← Cutter.bisect(p, v, ratio, b, split ? ALLEY(0.6) : 0.0)
  5. for each half:
        if half.area < minSq · 2^(4·sizeChaos·(rand() − 0.5)):      // STOCHASTIC threshold
             if !rand_bool(emptyProb): emit half                     // leaf building
        else:
             recurse(half, ..., split = half.area > minSq / (rand()·rand()))
```

Five things that matter:

1. **Always bisect the longest edge**, perpendicular to it (rotated by `b`). This is what keeps footprints rectangular.
2. **`ratio` is centred on 0.5** with half-width `0.4·gridChaos`. At `gridChaos = 0.2` (Administration) the cut is at 0.42–0.58 — near-perfect halving, regular grid. At `gridChaos = 1.0` (Slum) it's 0.1–0.9 — wildly uneven blocks.
3. **Angle jitter is suppressed below `4·minSq`.** Source comment: *"Trying to keep buildings rectangular even in chaotic wards."* Big blocks get skewed cuts; the last two levels of recursion are always square-on. **This is the single most important trick for the MFCG look** — without it, small buildings come out as random quadrilaterals and the map reads as noise.
4. **The stop threshold is stochastic**: `minSq · 2^(4·sizeChaos·(U−0.5))`. At `sizeChaos = 0.8` the effective minimum spans `minSq·2^±1.6` ≈ **×0.33 … ×3.0**, so a single ward contains buildings across a 9× area range. At `sizeChaos = 0.3` (Administration/Military) it's `×0.66…×1.5` — uniform.
5. **`split` controls whether an alley gap is cut.** `split = half.area > minSq/(U·U)`. Since `E[1/(U·U)]` diverges, the RHS is usually enormous ⇒ **`split = false` for most deep recursions ⇒ gapless cuts ⇒ terraced rows of houses sharing party walls.** Only large blocks get a real 0.6-unit alley. This is exactly right for medieval terraces and is the second-most-important trick.

### 5.3 `Cutter.bisect` **[OS]**

```ts
function bisect(poly: Polygon, vertex: V, ratio = 0.5, angle = 0, gap = 0): Polygon[] {
  const next = polyNext(poly, vertex);
  const p1 = lerp(vertex, next, ratio);
  const d  = sub(next, vertex);
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  const vx = d.x * cosB - d.y * sinB;
  const vy = d.y * cosB + d.x * sinB;
  const p2 = { x: p1.x - vy, y: p1.y + vx };   // p1 + rot90(rot(d, angle))
  return cut(poly, p1, p2, gap);
}
```
The cut line passes through `p1` **perpendicular** to the edge direction rotated by `angle`. `p2` is only a direction hint — `cut` extends the line infinitely.

### 5.4 `Cutter.ring` **[OS]** — hollow blocks / cloisters

```ts
function ring(poly: Polygon, thickness: number): Polygon[] {
  const slices = [];
  forEdge(poly, (v1, v2) => {
    const v = sub(v2, v1);
    const n = norm(rot90(v), thickness);        // inward normal, length = thickness
    slices.push({ p1: add(v1, n), p2: add(v2, n), len: len(v) });
  });
  slices.sort((a, b) => a.len - b.len);          // "Short sides should be sliced first"
  const peel: Polygon[] = [];
  let p = poly;
  for (const s of slices) {
    const halves = cut(p, s.p1, s.p2);
    p = halves[0];                                // keep the inner remainder
    if (halves.length === 2) peel.push(halves[1]); // the peeled strip is a building
  }
  return peel;                                    // the CORE (final p) is DISCARDED
}
```
Sorting short-edges-first prevents a long edge's slice from eating the whole polygon before the short ones are peeled. Used by `Cathedral` 40% of the time (`thickness = 2 + 4r`).

**Upgrade:** keep the discarded core and label it a **courtyard/cloister**. Watabou throws away the exact polygon you need for the most characteristic medieval building type. One-line change, large visual payoff.

### 5.5 `Cutter.radial` / `semiRadial` **[OS]** — parks

```ts
radial(poly, center = centroid(poly), gap):
  for each edge (v0,v1): sector = [center, v0, v1]; if gap: sector = shrink(sector, [gap/2, 0, gap/2])
  // → a pie slice per edge

semiRadial(poly, center = vertex nearest centroid, gap):
  gap /= 2
  for each edge (v0,v1) where v0 !== center && v1 !== center:
      sector = [center, v0, v1]
      d = [ findEdge(poly, center, v0) === -1 ? gap : 0,  0,  findEdge(poly, v1, center) === -1 ? gap : 0 ]
      sector = shrink(sector, d)
```
`radial` fans from the interior centroid (compact blocks); `semiRadial` fans from an actual **vertex** of the block, skipping the two sectors that would be degenerate (elongated/concave blocks). Only Park uses these — they read as tree clumps/lawns, not buildings, and are rendered in `palette.medium` with no stroke.

### 5.6 `Ward.createOrthoBuilding` **[OS]** — castle / cathedral / farm

```
createOrthoBuilding(poly, minBlockSq, fill):
  if poly.area < minBlockSq: return [poly]
  c1 = poly.vector(findLongestEdge(poly))     // direction of the longest edge
  c2 = rot90(c1)
  loop until non-empty: return slice(poly, c1, c2)

slice(poly, c1, c2):
  v0 = findLongestEdge(poly); v1 = poly.next(v0); v = v1 − v0
  ratio = 0.4 + rand()·0.2                     // tighter than createAlleys
  p1 = lerp(v0, v1, ratio)
  c  = |dot(v, c1)| < |dot(v, c2)| ? c1 : c2   // pick the axis MORE PERPENDICULAR to this edge
  halves = poly.cut(p1, p1 + c)                // NO gap — buildings touch
  for each half:
    if half.area < minBlockSq · 2^(Random.normal()·2 − 1):
        if rand_bool(fill): emit half
    else: recurse
```
Two fixed global axes `c1 ⟂ c2` ⇒ **every cut is axis-aligned to the same frame** ⇒ a rectilinear, orthogonal complex. `Random.normal()` = mean of 3 uniforms (Irwin–Hall, mean 0.5), so the exponent is roughly `N(0, 0.33)` — much tighter than `createAlleys`. `fill < 1` (0.5–0.8) leaves gaps that read as courtyards and wings. This is how you get a castle that looks built rather than subdivided.

`findLongestEdge(poly) = poly.min(v => −|poly.vector(v)|)`.

### 5.7 `Ward.filterOutskirts` **[OS]** — the fade-out

Applied by `CommonWard` when `!model.isEnclosed(patch)`. Two independent fields multiply:

```
// (a) "populated edges" — edges that face something urban
for each edge (v1,v2) of patch.shape:
    if edge is on an artery:                    addEdge(v1, v2, 1.0)
    else if neighbour n exists && n.withinCity: addEdge(v1, v2, isEnclosed(n) ? 1.0 : 0.4)
addEdge(v1, v2, factor):
    store {origin v1, dir (v2−v1), d = factor · max over patch vertices of distance2line(...)}

// (b) per-vertex density
density[i] = gates.contains(v)                                   ? 1
           : patchByVertex(v).every(p => p.withinCity)           ? 2·rand()
           : 0

// keep a building iff:
minDist = min over populated edges, over building vertices of (distance2line(edge, v) / edge.d)  // clamped to 1
p       = Σ_j density[j] · interpolate(buildingCentre)[j]        // inverse-distance barycentric blend
keep    = Random.fuzzy(1) > minDist / p
```
`Polygon.interpolate(p)` = normalised inverse-distance weights over the ward's vertices (Shepard). `Random.fuzzy(1) = normal()` = mean of 3 uniforms. So a building near a road/urban edge, in a corner of the ward surrounded by city, almost always survives; one in the far corner of a fringe ward almost never does. **This is what makes MFCG's outskirts dissolve instead of ending abruptly.**

**[MFCG]** replaced this with a barycentric density field over a triangulation of the whole district: **1 inside walls, 9 outside**, road-facing 0.3, wall 0.5, canal 0.1. Devlog [0.10.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha): *"decreases the density of streets there, while keeping the density of buildings along those streets relatively high."*

---

## 6. Geometry utilities

All from `Polygon.hx` **[OS]**. Conventions: **CCW positive**, `rot90(p) = (−p.y, p.x)` = **inward** normal for a CCW ring.

### 6.1 `cut(p1, p2, gap)` — the primitive everything else is built from

```ts
function cut(poly: Polygon, p1: V, p2: V, gap = 0): Polygon[] {
  const x1 = p1.x, y1 = p1.y, dx1 = p2.x - x1, dy1 = p2.y - y1;
  let edge1 = 0, r1 = 0, edge2 = 0, r2 = 0, count = 0;
  for (let i = 0; i < poly.length; i++) {
    const v0 = poly[i], v1 = poly[(i + 1) % poly.length];
    const t = intersectLines(x1, y1, dx1, dy1, v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
    if (t && t.y >= 0 && t.y <= 1) {              // t.y = param along the polygon edge
      if (count === 0) { edge1 = i; r1 = t.x; } else if (count === 1) { edge2 = i; r2 = t.x; }
      count++;
    }
  }
  if (count !== 2) return [poly.slice()];          // degenerate — return unchanged
  const point1 = add(p1, scale(sub(p2, p1), r1));
  const point2 = add(p1, scale(sub(p2, p1), r2));
  let half1 = [point1, ...poly.slice(edge1 + 1, edge2 + 1), point2];
  let half2 = [point2, ...poly.slice(edge2 + 1), ...poly.slice(0, edge1 + 1), point1];
  if (gap > 0) { half1 = peel(half1, point2, gap / 2); half2 = peel(half2, point1, gap / 2); }
  const v = vectori(poly, edge1);
  return cross(dx1, dy1, v.x, v.y) > 0 ? [half1, half2] : [half2, half1];  // deterministic side order
}
```
`intersectLines` returns `(t1, t2)` params, `null` when parallel. The `count !== 2` guard is the only robustness net — with `count > 2` (a cut crossing a concave polygon 4×) it silently keeps the first two crossings and **produces garbage**. Add a proper convex/concave split, or clip against the half-plane properly.

The returned order is **stable by side of the cutting line**, which `shrink` and `ring` rely on.

### 6.2 `peel(v1, d)` — inset exactly one edge

`peel(v1, d) = cut(v1 + n, v2 + n, 0)[0]` where `v2 = next(v1)`, `n = norm(rot90(v2−v1), d)`. Used by `cut` to open the `gap`, and by `ring`.

### 6.3 `shrink(d: number[])` — convex inward offset

```ts
function shrink(poly, d) {
  let q = poly.slice(); let i = 0;
  forEdge(poly, (v1, v2) => {
    const dd = d[i++];
    if (dd > 0) {
      const n = norm(rot90(sub(v2, v1)), dd);
      q = cut(q, add(v1, n), add(v2, n), 0)[0];   // half-plane clip
    }
  });
  return q;
}
```
Successive half-plane clipping ⇒ **always produces a convex result**, never self-intersects, handles per-edge distances exactly. Cheap and exact for convex input. Wrong (over-clips) for concave input — hence the `isConvex()` test in `getCityBlock`. `shrinkEq(d)` = uniform.

### 6.4 `buffer(d: number[])` — general simple-polygon offset

The interesting one. Three phases:

```
PHASE 1 — build a probably-invalid offset ring
  for each edge (v0,v1) with distance dd:
      if dd == 0: push v0, v1
      else: n = norm(rot90(v1−v0), dd); push v0+n, v1+n
  // note: 2 vertices per edge, disconnected — corners are NOT joined
  // source comment: "here we may want to do something fancier for nicer joints"

PHASE 2 — resolve self-intersections by node insertion
  repeat until no cut:
    for i in [lastEdge .. n-3]:
      for j in [i+2 .. (i>0 ? n : n-1)]:
        t = intersectLines(edge_i, edge_j)
        if t && t.x,t.y ∈ (DELTA, 1−DELTA) with DELTA = 1e-6:
            pn = point on edge_i at t.x
            q.insert(j+1, pn); q.insert(i+1, pn)   // SAME Point object inserted TWICE
            restart
PHASE 3 — extract the largest simple component
  walk the ring; at each step, next = (i+1) % n;
  jump to the OTHER index holding the same Point object (indexOf, else lastIndexOf)
  → each closed walk is one component; keep the one with the largest signed area
```
Phase 3 is the elegant part: inserting the **same object reference** at two positions turns the self-intersecting ring into a graph whose components you can trace by identity. In TypeScript, insert a shared `{x,y,id}` node or an index into a node array — do **not** insert two structurally-equal-but-distinct objects.

**Complexity is O(n³) worst case** (restart-on-every-cut). For blocks of ≤30 vertices that's fine. If you need better, use [Clipper2](https://github.com/AngusJohnson/Clipper2) / `polygon-clipping` for a proper Minkowski offset with miter/round joins — but note Watabou's version supports **per-edge distances**, which standard offset libraries don't. Keeping it is the pragmatic choice.

**Doc comment from the source, worth heeding:** *"It's kind of reliable for both convex and concave vertices, but only if all distances are equal. Otherwise weird 'steps' are created."*

### 6.5 `inset(p1, d)` / `insetAll` — fixed-vertex-count inset

Moves the two endpoints of one edge along the adjacent edges by `t = d / sin(angle)`, clamped to `min(t, |v0|·0.99)` at convex vertices and `min(t, |v1|·0.5)` at concave ones, signed by the cross product. Preserves vertex count; the source calls it *"not very reliable."* Unused in the main path — skip it.

### 6.6 Keeping footprints from self-intersecting

The reason MFCG footprints never self-intersect is structural, not numerical:

1. **Every building is produced only by `cut`** — a convex operation on the piece it's applied to. Cuts of a convex polygon are convex.
2. Blocks are made convex up front by `shrink`, or repaired by `buffer`'s largest-component extraction.
3. `bisect` always cuts perpendicular to the *longest* edge, so the two halves have bounded aspect ratio and `cut` reliably finds exactly 2 crossings.

Add two guards **[from ProbableTrain, verified]**: reject slivers by **shape index** `area / perimeter² < 0.04` (rejects anything thinner than ~1:4), and reject leaves with `< 4` vertices. **[MFCG]** does the same plus `OBB sides ≥ 1.2` and `area / OBBarea > 0.5`.

### 6.7 Other primitives worth having

`square` (shoelace ×0.5, signed) · `perimeter` · `compactness = 4π·area/perimeter²` · `center` (vertex mean) vs `centroid` (area-weighted) · `isConvexVertex(v) = cross(v1−v0, v2−v1) > 0` · `simplyfy(n)` (greedily drop the vertex with smallest triangle area — Visvalingam) · `filterShort(threshold)` · `split(p1,p2)` (slice the ring at two existing vertices) · `interpolate(p)` (Shepard weights) · `rect(w,h)` · `regular(n,r)` · `circle(r) = regular(16, r)`.

---

## 7. City context: water, coast, farms

**None of this exists in the OS build.** `Model.waterbody` is declared and never assigned; `Topology`'s comment mentions "shore" but nothing sets it. Everything below is **[MFCG]**, recovered from `mfcg.js` and the devlogs. The pipeline gained two stages: `buildDomains` (land/water topology) and `buildCanals` (rivers):

```
buildPatches → optimizeJunctions → buildDomains → buildWalls →
buildStreets → buildCanals → createWards → buildCityTowers → buildGeometry
```

### 7.1 The mechanism that makes all of it work: **edge tagging**

`model.Edge` carries a kind: `HORIZON | COAST | ROAD | WALL | CANAL`. **Water never cuts geometry.** The river runs *along Voronoi cell boundaries*; every half-edge on its course is tagged `CANAL`, and each ward's `getAvailable()` insets by a per-edge-kind amount:

```
coast:  1.2   (2.0 if the cell is a landing)
road:   1.0
wall:   THICKNESS/2 + 1.2  = 0.95 + 1.2
canal:  canalWidth/2 + 1.2  (+1.2 extra at the source vertex)
plaza-facing: 1.0
default: 0.6
```
One inset table drives rivers, coasts, walls, roads and plazas identically. **This is the single most transferable idea in the whole system** — it's §5.1 generalised, and it composes cleanly where boolean geometry would not.

### 7.2 Rivers — `Canal`

Exactly **one** canal is built (`canals = riverNeeded ? [Canal.createRiver(this)] : []`), despite the array. Routing graph covers non-water cells only, excluding the wall polygon, citadel wall vertices, all gates and all existing arteries — so a river can never run along a street or through a wall except transversally.

- **`regularRiver`** (inland): pick a horizon vertex `k`; find the horizon vertex `n` most opposite (min dot of normalised positions); A* `n → (vertex adjacent to center)`, then A* `→ k`; splice at the first common vertex.
- **`deltaRiver`** (coastal): mouths = shore vertices with >1 non-water neighbour cell, sorted by distance from origin; upstream target = max dot with the shore normal.

`validateCourse` rejects: length `< earthEdge.length/5`; touching the shore at an interior vertex; non-transversal crossing of wall or artery. Then `smoothOpen` (Chaikin), snap to shore at the mouth, and pull to the exact wall intersection where it crosses.

```
width = (3 + inner.length/5) · (0.8 + 0.4·rnd) · (rural ? 1.5 : 1)
```
`rural` = no interior course vertex borders an inner cell. A 25-patch city → base 8 units = **32 m**, ±20%, ×1.5 if it merely skirts the city.

**Watergates:** where the course crosses a wall vertex → `wall.addWatergate(v, canal)`, and that vertex is removed from the tower list.

**Bridges:** every artery vertex genuinely crossing the course becomes a bridge. Extra bridges are added on candidate vertices (course vertices bordering an inner cell, minus watergates) with continuation probability `1 − 2·nBridges/nCandidates`, weighted `1/vertex.edges.length`. Exported as 2-point segments of length `canalWidth + 1.2` perpendicular to the course, in the `planks` layer.

**Islands are not supported.** `buildDomains` keeps only the *largest* connected land component and the *largest* water component; stray islands are discarded, and it throws if the water body doesn't touch the horizon.

### 7.3 Coast — a noise-perturbed rotated disc

```
noise = fractalPerlin(6 octaves)
f = 20 + 40·rnd
k = 0.3·maxR·(avg3(rnd)·2 − 1)
n = maxR·(0.2 + |...|)                      // sea radius
coastDir = urlParam.sea ?? floor(rnd·20)/10  // 0..1.9  (0=E, 0.5=N, 1=W, 1.5=S)
h = coastDir·π ; rotate every cell centroid by (cos h, sin h) → p'
g = (n + f, k)
u = dist(g, p') − n ;  if (p'.x > g.x) u = min(u, |p'.y − k| − n)   // half-plane cap
r = noise((p'.x + maxR)/(2·maxR), (p'.y + maxR)/(2·maxR)) · n · sqrt(|p'| / maxR)
if (u + r < 0) cell.waterbody = true
```
The `sqrt(|p'|/maxR)` term scales noise amplitude with distance from centre — **smooth coast near the city, jagged far out**. `waterEdge` then gets 1–3 Chaikin passes.

### 7.4 Harbour, landings, piers

```js
maxDocks = floor(sqrt(size / 2)) + (riverNeeded ? 2 : 0)
```
Inner cells bordering the shore become `landing = true` until the budget is spent; a cell wedged between two landings is promoted too. If a gate street can't reach the horizon, that gate's shore cells are force-promoted.

**The harbour ward is the *water* cell adjacent to a landing**, not a land cell. That's the non-obvious modelling choice, and it makes piers trivial — the pier normal comes free from the shared land/water edge:

```
edge   = longest edge shared with a landing cell (trimmed to midpoint if it touches a river mouth)
nPiers = floor(len / 6)
each pier = 2-point segment of length 8 units (32 m) normal to the shore
spacing margin = (1 − 6·(n−1)/len) / 2
```
Wall sections bordering water are deleted (`segments[i] = false`).

### 7.5 Farmland — a two-harmonic lobed envelope

```
a = 2·avg3(rnd); b = avg3(rnd); c, d = rnd·2π
θ = bearing of cell from centre
g = a·sin(θ + c) + b·sin(2θ + d)
dist(cell, centre) < (g + 1)·maxCityRadius  →  Farm    else  Wilderness
```
Not a radius — a lobed blob, so farmland reaches further along some bearings. Constants `MIN_SUBPLOT = 400`, `MIN_FURROW = 1.3`. Fields are exported as `subPlots` polygons plus `furrows` line segments. The OS build's version is much cruder (`Random.bool(0.2) && compactness ≥ 0.7`).

### 7.6 Suburbs — three mechanisms

1. **Gate suburbs** (also in OS): per wall gate, probability `1 − 1/(nPatches−5)`, promote surrounding cells to `withinCity` + urban ward.
2. **Shanty towns** (`?shantytown=1`): add `nPatches·(1+rnd³)·0.5` outside cells, weighted `k²/d²` where `k` = urban-neighbour count and `d = min(3·dist(centre), 2·dist(road vertex), dist(shore vertex), dist(canal vertex))` — so they hug roads, river and coast. Devlog [0.6.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/67134/060-custom-colors-scale-bar-elevation).
3. **Density falloff** (§5.7).

Real-world calibration: Bristol c.1300 had 55 ha intramural, 130 ha total ⇒ **suburbs are 58% of built-up area** ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678)).

### 7.7 Terrain outside town

**[OS]**: nothing. Non-city patches get `new Ward()` with empty geometry and aren't even added to the display list (`default: patchDrawn = false`).
**[MFCG]** 0.11.4 adds `Forester`: `PoissonPattern(30, 30, 2.25)` + 5-octave Perlin (base grid 0.05, persistence 0.5), keep a point if `(noise+1)/2 < density`; forests fill all space not occupied by city, farmland or water, and roads are drawn *under* the forest.

---

## 8. Rendering style

### 8.1 Palettes **[OS]** — `Palette.hx`, verbatim

Four slots only: `paper, light, medium, dark`.

| Preset | paper | light | medium | dark |
|---|---|---|---|---|
| **DEFAULT** | `#CCC5B8` | `#99948A` | `#67635C` | `#1A1917` |
| BLUEPRINT | `#455B8D` | `#7383AA` | `#A1ABC6` | `#FCFBFF` |
| BW | `#FFFFFF` | `#CCCCCC` | `#888888` | `#000000` |
| INK | `#CCCAC2` | `#9A979B` | `#6C6974` | `#130F26` |
| NIGHT | `#000000` | `#402306` | `#674B14` | `#99913D` |
| ANCIENT | `#CCC5A3` | `#A69974` | `#806F4D` | `#342414` |
| COLOUR | `#FFF2C8` | `#D6A36E` | `#869A81` | `#4C5950` |
| SIMPLE | `#FFFFFF` | `#000000` | `#000000` | `#000000` |

Role mapping: **`paper`** = background (`stage.color`) and the fill of road ribbons. **`light`** = building fill. **`medium`** = park groves and road casing. **`dark`** = all outlines, walls, towers, gates.

### 8.2 Strokes **[OS]** — `Brush.hx`

```
THIN_STROKE = 0.150;   NORMAL_STROKE = 0.300;   THICK_STROKE = 1.800;
```
Joints are `MITER` by default. (At 4 m/unit: normal stroke = 1.2 m, wall = 7.2 m.)

### 8.3 Draw order and per-element recipe **[OS]** — `CityMap.hx`

```
1. roads          (bottom)
2. patch geometry (per ward type)
3. invisible hot areas for tooltips
4. city wall, then citadel wall  (top)
```

**Roads — two overlaid strokes, no fill:**
```
lineStyle(MAIN_STREET + NORMAL_STROKE = 2.3, palette.medium, caps = NONE); drawPolyline(road)
lineStyle(MAIN_STREET − NORMAL_STROKE = 1.7, palette.paper);                drawPolyline(road)
```

**Buildings — outline pass then fill pass (`drawBuilding`):**
```
setStroke(line = palette.dark, width = thickness · 2); for each block: drawPolygon
noStroke(); setFill(palette.light);                    for each block: drawPolygon
```
Drawing the stroke at **double width first and then filling on top** leaves exactly `thickness` of visible outline and — crucially — makes adjacent buildings' outlines merge into one continuous line rather than doubling. That's the ink-on-paper look. `thickness`: Castle `NORMAL_STROKE·2 = 0.6`, Cathedral `0.3`.

**Common wards** skip the two-pass and just `setColor(g, light, dark)` (stroke `0.3`) then `drawPolygon` each building.

**Parks**: `setColor(g, medium)` — fill only, **no stroke**, so groves read as soft blobs.

**Wall**: `lineStyle(THICK_STROKE = 1.8, dark); drawPolygon(wall.shape)`.
**Tower**: filled circle, `r = 1.8` (`× 1.5 = 2.7` for the citadel), no stroke, `dark`.
**Gate**: a stroke of width `THICK_STROKE·2 = 3.6` in `dark`, drawn **across** the wall:
```
dir = normalize(wall.next(gate) − wall.prev(gate)) · (THICK_STROKE · 1.5 = 2.7)
line from gate − dir to gate + dir            // total length 5.4 units ≈ 22 m
```

**Camera** (`TownScene.layout`): centre the map, `scale = (scMax/scMin > 2 ? scMax/2 : scMin) · 0.5` where `scMin/scMax` are `min/max(rWidth/cityRadius, rHeight/cityRadius)`.

**Labels [OS]:** there is no label layer — `getLabel()` feeds a hover **tooltip** only ("Craftsmen", "Slum", "Temple", "Castle", "Market", "Park", "Farm", "Gate", …). No legend, no scale bar. **[MFCG]** added map labels in 0.5.5 (Archivo Narrow), a scale bar in 0.6.0, and curved labels along straight-skeleton "ridges" in 0.11.1.

### 8.4 Modern palettes **[MFCG]** — 10 slots

Keys: `colorPaper, colorDark(Ink), colorRoof, colorWater, colorGreen, colorRoad, colorWall, colorTree, colorLabel, colorLight(Elements)`, plus `tintMethod`, `tintStrength` (0–100, default 50), `weathering` (0–100, default 20). Fallbacks: `roof→light`, `water/green/road→paper`, `wall/tree/label→dark`. Downloadable at [watabou.github.io/city_styles.html](https://watabou.github.io/city_styles.html) (`styles/city_<name>.json`).

| | Paper | Ink | Roof | Water | Green | Road | Wall | Tree | Label | Light | tint | str |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **default** | `#CCC5B8` | `#1A1917` | `#A5A095` | `#7F7A71` | `#A59F93` | `#CCC5B8` | `#1A1917` | `#7F7A71` | `#1A1917` | `#CCC5B8` | Brightness | 30 |
| **ink** | `#CCCAC2` | `#130F26` | `#9A979B` | `#6C6974` | `#A5A2A2` | `#CCCAC2` | `#130F26` | `#47454C` | `#150C3F` | `#BFBFBF` | Brightness | 40 |
| **bw** | `#FFFFFF` | `#000000` | `#DDDDDD` | `#FFFFFF` | `#EEEEEE` | `#FFFFFF` | `#000000` | `#EEEEEE` | `#000000` | `#FFFFFF` | Brightness | 0 |
| **vivid** | `#FFF2C8` | `#4C5950` | `#D6A36E` | `#779988` | `#C3CC99` | `#FFF2C8` | `#606661` | `#667755` | `#2D3D4C` | `#F2F2DA` | Spectrum | 20 |
| **natural** | `#BFBFB5` | `#3F322C` | `#66707F` | `#8F9997` | `#8D927B` | `#E1DBD5` | `#4C4C4C` | `#777F66` | `#662C28` | `#D8D8CD` | Spectrum | 20 |
| **modern** | `#E5E5DA` | `#333333` | `#E5B75B` | `#59A3B2` | `#CCCCA3` | `#CCCCC1` | `#666660` | `#777F66` | `#222222` | `#D8D8C3` | Overlay | 25 |
| **fairytale** | `#A5A552` | `#261C16` | `#7F543F` | `#66727F` | `#D8A641` | `#CCB7A3` | `#FFD8B2` | `#516655` | `#FFFFE5` | `#EEEEEE` | Overlay | 20 |
| **tapestry** | `#CCB28E` | `#1E2232` | `#8C4D5C` | `#95A59D` | `#A59D74` | `#B2946B` | `#66625B` | `#727F66` | `#1E2232` | `#E5CEA0` | Spectrum | 25 |
| **academia** | `#D7BA9C` | `#28263B` | `#7D83A5` | `#606277` | `#B28E7C` | `#CDC3A8` | `#FFEFBF` | `#8C7055` | `#1C1933` | `#FAF7A8` | Overlay | 20 |
| **turquoise** | `#D1B488` | `#281B12` | `#CB5644` | `#91B8A3` | `#998F4A` | `#E6DAC2` | `#F9F9DD` | `#344E4D` | `#212C48` | `#F9EDBD` | Overlay | 20 |
| **june** | `#BFC192` | `#262316` | `#8C8069` | `#ADC6CB` | `#929971` | `#DED9BC` | `#646152` | `#647650` | `#262316` | `#CCC2A1` | Spectrum | 8 |

Note `default.paper` is **identical** to the OS `DEFAULT.paper` — the lineage is unbroken.

**Tint functions** (per-district / per-roof variation, `b` = index, `c` = count):
```
spectrum(a,b,c):   hsv(h − 360·(c−1)/c · str/100 · (b/(c−1) − 0.5), s, v)
brightness(a,b,c): hsv(h, s, v + min(v, 1−v) · str/50 · (b/(c−1) − 0.5))
overlay(a,b,c):    lerp(rgb, hsv(h + 360·b/c, s, v), str/100)
```

**Corrections to widespread assumptions:**
- **There is no paper texture.** `colorPaper` is a flat fill. The "ink on paper" feel comes entirely from the 4-value palette + the double-stroke building outline + hairline strokes.
- **Hatching was removed** in 0.9.2 (it shipped in 0.4.1). Zero `hatch` hits in the current bundle. Field rendering is now `Furrows` (line segments in `colorGreen`, default), `Plain` (solid `colorGreen` subplots), or `Hidden` — pref key is `farm_fileds`, misspelling shipped.
- **Blueprint** removed 0.9.1; **Night** removed 0.9.2; **Ancient** never existed in MFCG (only in the OS build).
- Modern stroke widths: `strokeThin 0.8 / strokeNormal 1.6 / strokeThick 3.2`, ÷3 when "Thin lines" is on.
- Roof ridges (0.11.0) are drawn from a **straight skeleton**: footprint vertices jittered by `polar(0.1·(avg3(rnd)·2−1), π·rnd)`, bones with `slope.length > 1.2` drawn as ridge lines.

### 8.5 Export

**[MFCG]** JSON is "GeoJSON-like but not GeoJSON". Transform: `[round(1000·x·4)/1000, round(1000·(−y)·4)/1000]` — **Y negated, ×4, 3 decimals**. Feature order: `values, earth, roads, walls, rivers, planks, buildings, prisms, squares, greens, fields, trees, districts[, water]`. `values` has `roadWidth: 8, towerRadius: 7.6, wallThickness: 7.6, generator: "mfcg", version, riverWidth` and **`geometry: null`**. `planks` = piers **and** bridges. `water` key is absent entirely when there's no water. Only district **names** carry semantics — types, ward classes and seeds are not exported. Discussion: [itch.io/t/2733960](https://itch.io/t/2733960/geojson), [itch.io/t/773197](https://itch.io/t/773197/geojson-format).

**Interop win:** accept MFCG's URL params — `name, population, size, seed, river, coast, farms, citadel, urban_castle, hub, plaza, temple, walls, shantytown, gates, sea, style, export, preview` — and you drop straight into [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) ecosystem, whose users are the largest downstream consumer of MFCG. FMG's population→size law (`modules/ui/editors.js`):
```ts
size = minmax(Math.ceil(2.13 * ((pop * populationRate) / urbanDensity) ** 0.385), 6, 100);
```

---

## 9. How to beat MFCG

Ranked by (visual payoff) / (implementation cost).

### 9.1 Free wins — fix the bugs (hours)

| | Fix |
|---|---|
| `Polygon.distance` returns distance to vertex[0] | `d = d1` — makes every radial ward heuristic actually work |
| `aStar` is FIFO Dijkstra | binary-heap A* with Euclidean `h` ([redblobgames](https://www.redblobgames.com/pathfinding/a-star/introduction.html)) |
| Lloyd relaxation is a no-op (frame offset) | drop it; hard-code the plaza rectangle like **[MFCG]** |
| `CurtainWall.real` is unconditionally `true` | honour the parameter |
| Deck exhaustion ⇒ all-Slum above 36 patches | weighted multinomial with per-type caps |
| Any failure ⇒ regenerate the whole city | local repair: re-pick the citadel patch, re-route one street |
| `Cutter.ring` discards the core | **keep it as a courtyard** — one line, biggest look-per-character in the codebase |
| `tidyUpRoads` never re-merges arteries | weld to fixpoint ⇒ visibly longer, more coherent streets |

### 9.2 Burgage plots — the single biggest realism win

MFCG's lots have **no consistent relationship to the street**: `createAlleys` bisects a blob recursively, so frontage is accidental. Real medieval plots are **strips perpendicular to a frontage line, of near-constant width**, in *series*.

Use **Vanegas et al., "Procedural Generation of Parcels in Urban Modeling" (EG 2012)**, [PDF](https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf), Algorithm 1 — it is literally a burgage-plot generator:

```
subdivSkeleton(block):
  SS  ← straightSkeletonOffset(contour(block), d_offset)   // d_offset = PLOT DEPTH
  LS  ← [convertToStrip(f) for f in SS.faces]               // α-strips
  LS2 ← mergeOnLogicalStreets(LS)                           // one strip per street frontage
  LS3 ← fixDiagonalEdges(LS2)                               // → β-strips
  for s in LS3: slice(s)     // rays PERPENDICULAR to the supporting edge,
                             // spacing ~ N((Wmin+Wmax)/2, σ² = 3ω)
  processSmallLargeOrTriangularLots(LS, Amin, Amax)          // union slivers with neighbours
```
Parameters: `Wmin,Wmax` = street frontage; `d_offset` = plot depth; `ω ∈ [0,1]` = split irregularity; `ξ` = street-access preference (`ξ=1` always guarantees access, `ξ=0` allows landlocked plots). **The leftover interior region with no street access is your backland / back lane / courtyard** — and the paper explicitly says it "can be further partitioned using an arbitrary subdivision style."

Real dimensions to plug in ([burgageplots.info](https://www.burgageplots.info/a-planned-approach), [Urban History: Scottish burgage plots](https://www.cambridge.org/core/journals/urban-history/article/framework-and-form-burgage-plots-street-lines-and-domestic-architecture-in-early-urban-scotland/4FC18665945BC7A9144C4C9165838A5A), [VCH Wilts vi](https://www.british-history.ac.uk/vch/wilts/vol6/pp69-72)):

```
UNIT      1 perch/rod/pole = 16.5 ft = 5.0292 m — quantise every plot dimension to this
FRONTAGE  modal 8.53–9.75 m (28–32 ft); full range 5–40 m
          Scottish metrology over 49 blocks: modal 5.76–12.80 m, clustering 8–9 m,
          plots in QUARTER-UNIT increments spanning 0.75–2.5 units, ~⅔ within ±0.5 m
DEPTH     ladder {35, 60, 90, 100, 201} m
W:D       1:2–1:3.5 planned cores (Salisbury 3×7 perches, Stratford 3½×12, bastide ayral 8×24 m)
          1:5–1:6   common English default (Charmouth 4×20 perches)
          1:10–1:11 long tails to a back lane (Hungerford 2×20 rods, Tewkesbury 4×40)
BACK LANE 4.9–7.3 m (bastide venelle 1–3 m)
```
*Why 8–10 m:* it's the max practical span of a single oak beam. A medieval room spans ~15 ft, so a 28-ft plot = two rooms, or one room plus a side passage. **Emit plots as a series sharing one frontage line and depth — never independently.** That's Conzen's "plot series," and it's what makes real towns look designed rather than diced.

### 9.3 Streets that aren't cell edges

**[OS]** streets *are* Voronoi edges, so no street can cross a ward, there are no through-routes, and hierarchy is three hard-coded widths. Two replacements:

**Tensor fields** — Chen et al., *Interactive Procedural Street Modeling* (SIGGRAPH 2008), [PDF](https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf). Encode `T = R·[cos2θ, sin2θ; sin2θ, −cos2θ]`; place *radial* elements at gates and the market, *grid* elements in planned quarters, a *boundary* element along the river, a *height-field* element on slopes; blend `T(p) = Σ e^(−d‖p−pᵢ‖²)·Tᵢ(p)`; add a Perlin **rotation field** `R₁ ∈ [−π/2, π/2]` that rotates major and minor eigenvectors in *opposite* directions — that's what breaks perpendicularity and gives organic form. Trace streamlines with adaptive RK.

Tuned constants from [ProbableTrain/MapGenerator](https://github.com/probabletrain/mapgenerator) (`src/ts/ui/main_gui.ts`) — note the clean **1 : 5 : 20** `dsep` ladder:
```
minor: dsep 20,  dtest 15, dstep 1, dlookahead 40, dcirclejoin 5, joinangle 0.1,
       pathIterations 1000, seedTries 300, simplifyTolerance 0.5
major: dsep 100, dtest 30, dlookahead 200
main:  dsep 400, dtest 200, dlookahead 500
buildings: maxLength 20, minArea 50, shrinkSpacing 4, chanceNoDivide 0.05
```
Apache-2.0 Go port with RK4 + flatbush: [Flokey82/go_gens](https://github.com/Flokey82/go_gens) `gencitymap/`.

**Or L-systems** — Parish & Müller, *Procedural Modeling of Cities* (SIGGRAPH 2001), [PDF](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf). The contribution is the **ideal successor**: the L-system emits a template with unassigned parameters, `globalGoals()` fills them from population steering (`direction = argmax_ray Σ density(p)/dist(p, roadEnd)`), `localConstraints()` repairs by **prune → rotate → snap**. Pattern rules: Basic / New York / Paris-radial / San Francisco, blended by a greyscale weight map. Working constants from [phiresky/procedural-cities](https://github.com/phiresky/procedural-cities) and [t-mw/citygen-godot](https://github.com/t-mw/citygen-godot) (MIT):
```
DEFAULT_SEGMENT_LENGTH 300 / HIGHWAY 400;  branch angle ±3°, straight ±15°
BRANCH_PROBABILITY 0.4 normal / 0.02–0.05 highway
MINIMUM_INTERSECTION_DEVIATION 30°;  ROAD_SNAP_DISTANCE 50;  SEGMENT_COUNT_LIMIT 2000–7000
```

Cheaper middle path for the hinterland: Amit Patel's `Roads.as` in [mapgen2](https://github.com/amitp/mapgen2) draws roads on the **boundaries between elevation bands** of the Voronoi dual — always connected, always terrain-following. Substitute *density* bands for elevation bands and you get a free main-street network.

### 9.4 Building shape variety — L, U, courtyard, cruciform

**[OS]** every footprint is a convex product of straight cuts. No L-shapes, no courtyards, no cruciform churches. The fix is four rules from CGA Shape (Müller et al., SIGGRAPH 2006, [PDF](https://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf)):

```
1: lot ; S(1r, height, 1r) Subdiv("Z", Scope.sz·rand(0.3,0.5), 1r){ facades | sidewings }
2: sidewings ; Subdiv("X", Scope.sx·rand(0.2,0.6), 1r){ sidewing | ε }
               Subdiv("X", 1r, Scope.sx·rand(0.2,0.6)){ ε | sidewing }
3: sidewing ; S(1r, 1r, Scope.sz·rand(0.4,1.0)) facades      : 0.5
            ; S(1r, Scope.sy·rand(0.2,0.9), Scope.sz·rand(0.4,1.0)) facades : 0.3
            ; ε : 0.2
4: facades ; Comp("sidefaces"){ facade }
```
Rule 2 emits a wing on each side **independently** ⇒ **I (none) / L (one) / U (two)**, and the gap between wings **is** the courtyard. Rule 3's `0.5/0.3/0.2` sets wing depth/height variety. Four rules, whole vocabulary.

**Cruciform churches**: footprint = `nave ∪ transept ∪ chancel [∪ apse ∪ crossing tower]` as a union of oriented rectangles. Orient east-facing; align the nave to the local street grain **only if within ~45° of east**, otherwise force east — the misalignment against the surrounding grain is itself a strong realism cue. Then roof by **straight skeleton**, which produces the cross-gable automatically at the reflex corners of the crossing. Use [twak/campskeleton](https://github.com/twak/campskeleton) (Apache-2.0, weighted, supports negative weights for offsetting either direction) rather than CGAL (GPL/commercial). Reference: Kelly & Wonka, *Interactive Architectural Modeling with Procedural Extrusions* (TOG 2011), [PDF](https://peterwonka.net/Publications/pdfs/2011.TOG.Kelly.ProceduralExtrusions.TechreportVersion.final.pdf) — per-edge direction-plane angle `θ ∈ [−π/2, π/2]`, courtyards as explicit clockwise holes, robustness epsilons `δ₁=1e-4, δ₂=1e-6, δ₃=1e-5`.

Density check: York had ~45 parish churches c.1300 against 10–15k people ⇒ **1 church per 250–350 inhabitants** ([Medieval parish churches of York](https://en.wikipedia.org/wiki/Medieval_parish_churches_of_York)). A cathedral is not a building but a **walled precinct with its own gates** — Salisbury's Close is >32 ha ([Salisbury Cathedral](https://www.salisburycathedral.org.uk/visit-what-see/largest-cathedral-close)). Reserve the precinct first, then place the church inside; the precinct interrupts the plot series, which is exactly what real cathedral cities look like.

### 9.5 Growth history — the thing no generator does

Every MFCG city is one age. Real ones are stratified:

```
epoch 0: nucleus (castle / ford / abbey / crossroads) + market
epoch 1..n: expand outward; freeze a wall circuit at each epoch
every superseded wall line becomes a FIXATION LINE → INNER FRINGE BELT
  (cemeteries, friaries, gardens, hospitals, prisons — large parcels, low building coverage)
per plot series, run the BURGAGE CYCLE (≈180 yr, Alnwick):
  phase 1 fill the backland toward climax coverage
  phase 2 clearing;  phase 3 urban fallow
  then amalgamate 2–4 plots and redevelop at coarser grain
  truncate tails into tail-end plots fronting the back lane
```
This is M.R.G. Conzen's *Alnwick, Northumberland: A Study in Town-Plan Analysis* (1960) — the monograph isn't online, but the apparatus is summarised in [EPUM Briefing Paper 1](https://www.surf.com.cy/wp-content/uploads/2023/03/EPUM_BP1_Historical-Geographical.pdf) and the [Łódź fringe-belt paper](https://czasopisma.uni.lodz.pl/fgsoe/article/download/1205/874/0).

Add an **encroachment pass**: narrow streets by **1.6–2.9 m (mean 2.2)** in older quarters, and infill 20–40% of the market square with a building island. Measured from 13 Edinburgh/Canongate sites; Salisbury's surviving Oatmeal Row / Butcher Row / Fish Row are fossilised stall lines ([VCH](https://www.british-history.ac.uk/vch/wilts/vol6/pp85-87)).

### 9.6 Make the Voronoi invisible

Two cheap, high-impact tricks:

1. **[MFCG] 0.10.0**: merge adjacent cells into district-wide groups **before** subdividing, and run the bisection over the merged polygon. Watabou's own verdict: *"This change makes cells almost invisible and often there is an illusion of streets following some kind of underlying landscape. There is no underlying landscape of course."* ([devlog](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/576591/0100-alpha))
2. **Amit Patel's `NoisyEdges`** ([mapgen2](https://github.com/amitp/mapgen2)) — recursive quadrilateral midpoint displacement constrained inside the Voronoi/Delaunay quad, so edges are jagged but non-self-intersecting **and shared by both adjacent cells (no cracks)**. The art is the per-edge-type recursion floor: `minLength = 10` default, `3` at a type boundary, `1` for coast and river, `100` for open water.

### 9.7 Acceptance metrics — how to *prove* you beat it

Compute on your generated street graph and compare to real cities ([Boeing](https://escholarship.org/content/qt5db3f718/qt5db3f718.pdf), [Barthelemy 2024](https://arxiv.org/pdf/2409.08016), [PMC8585513](https://pmc.ncbi.nlm.nih.gov/articles/PMC8585513/)):

| Metric | Organic (W/S Europe) | Planned/grid |
|---|---|---|
| avg node degree | 2.5–2.8 | 3.0–3.5 |
| dead-end fraction | ~14% (to 39%) | low |
| degree-4 fraction | ~18% | ~2× |
| median segment length | **63–78 m** | ~100 m |
| circuity | ~6.4–6.5% | ~5% |
| orientation-order | **0.02–0.05** | 0.1–0.32 |
| intersections / km² | 73–116 | ~53 |
| **Gini of eigenvector centrality** | **0.71** | **0.47** |
| block area distribution | power law | — |

The Gini figure is the sharpest organic/planned discriminator (72 pre-industrial Afro-Eurasian sites, p<0.01). **MFCG will fail it** — Voronoi cell edges give near-uniform centrality, whereas real organic networks concentrate connectivity in a small spine. That's your provable improvement.

Size/population calibration ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0162678), 173 European cities c.1280–1320): `ln(area) = α + β·ln(pop)` with **β = 0.714** (95% CI 0.662–0.766) — bigger medieval cities are *denser*. Density gradient **200 inh/ha centre → 75 inh/ha periphery**. Typical enclosed area 20–81 ha; Winchelsea 1292 gives **13 plots/ha gross**. **[MFCG]** itself just does `population ≈ 6 × buildings`, rounded to 2 significant digits, and it's display-only.

### 9.8 Licensing

| Project | License | Copy? |
|---|---|---|
| watabou/TownGeneratorOS | GPL-3.0 | **No** — reimplement (algorithms/constants aren't copyrightable) |
| MFCG / Village Generator | closed | No |
| Azgaar/Fantasy-Map-Generator | MIT | Yes |
| Flokey82/go_gens | Apache-2.0 | Yes |
| twak/campskeleton | Apache-2.0 | Yes |
| t-mw/citygen-godot | MIT | Yes |
| amitp/mapgen2 | MIT | Yes |
| nothings/stb (herringbone Wang tiles) | public domain / MIT | Yes |
| ProbableTrain/MapGenerator | GPL-3.0 / LGPL-3.0 | LGPL parts linkable |
| phiresky/procedural-cities | AGPL | avoid for SaaS |
| CGAL `Straight_skeleton_2` | GPL / commercial | use campskeleton instead |

---

## Suggested build order

1. Indexed mesh + Delaunator Voronoi + the spiral (§0, §1.1–1.3) — you'll see recognisable patches on day one.
2. `cut` / `shrink` / `buffer` / `peel` (§6) — everything downstream is these four.
3. `findCircumference` → wall → gates → towers (§2).
4. Topology + real A* → streets/roads → weld → smooth (§3).
5. `getCityBlock` + `createAlleys` with the **angle-suppression** and **gapless-split** rules (§5.1–5.2) — this is the moment it starts looking like MFCG.
6. Wards + `rateLocation` (§4), then `filterOutskirts` (§5.7).
7. Renderer: 4-colour palette, double-stroke buildings, two-pass roads (§8).
8. Then upgrade: edge-tagged water/coast (§7.1), districts (§4.5), burgage plots (§9.2), CGA wings (§9.4).

Local checkout of the ground-truth source is at `/home/claude/TownGeneratorOS` if you want to diff against it while porting.

agentId: a8e1a0328f4d2abda (use SendMessage with to: 'a8e1a0328f4d2abda', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 188789
tool_uses: 23
duration_ms: 3273728</usage>