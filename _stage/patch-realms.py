# -*- coding: utf-8 -*-
import io, re

p = "src/engines/worldgen/core/settlements.ts"
s = io.open(p, encoding="utf-8").read()
old = """  const paintedRealms = world.painted?.realmCells;
  if (paintedRealms) {
    const limit = realms.length;
    for (let i = 0; i < W * H; i++) {
      const v = paintedRealms[i];
      if (v === -2) continue;                       // untouched
      if (v >= limit) continue;                     // a realm this world no longer has
      realmOf[i] = elevation[i] > 0 ? v : -1;       // never claim open water
    }
    for (const r of realms) r.cellCount = 0;
    for (let i = 0; i < W * H; i++) {
      const r = realmOf[i];
      if (r >= 0 && r < limit) realms[r].cellCount++;
    }
  }
"""
assert old in s, "build-side overlay block not found"
s = s.replace(old, "  applyPaintedRealms(world, realmOf, realms);\n", 1)
anchor = "export function buildHumanGeography("
assert anchor in s
helper = '''/**
 * Lay the reader's painted frontiers over a realm map.
 *
 * Exported and shared because it runs in TWO places that must agree exactly:
 * the full build in `buildHumanGeography`, and the cheap patch in
 * `patchGeography` that is the only thing that runs after a stroke. When they
 * drifted, the frontier brush drew nothing until a nineteen-second rebuild that
 * itself waits for the brush to be put away - which, from the reader's chair,
 * is a tool that does not work.
 *
 * Mutates `realmOf` in place and refreshes `cellCount`. Returns false and
 * touches nothing when there is no overlay, so a world nobody has painted pays
 * one property read.
 *
 * Two rules the generator's own flood fill also obeys, restated here because
 * this runs after it: a realm never holds open water, and a realm index this
 * world no longer has is ignored rather than trusted - an edit list outlives
 * the world it was drawn on, and a saved stroke naming realm 11 must not
 * corrupt a map that now has six.
 */
export function applyPaintedRealms(
  world: WorldData,
  realmOf: Int32Array,
  realms: { cellCount: number }[],
): boolean {
  const painted = world.painted?.realmCells;
  if (!painted) return false;
  const N = world.width * world.height;
  const limit = realms.length;
  const { elevation } = world;
  for (let i = 0; i < N; i++) {
    const v = painted[i];
    if (v === -2) continue;                       // untouched: the reader never said
    if (v >= limit) continue;                     // a realm this world no longer has
    realmOf[i] = elevation[i] > 0 ? v : -1;       // never claim open water
  }
  for (let r = 0; r < limit; r++) realms[r].cellCount = 0;
  for (let i = 0; i < N; i++) {
    const r = realmOf[i];
    if (r >= 0 && r < limit) realms[r].cellCount++;
  }
  return true;
}

'''
s = s.replace(anchor, helper + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("settlements.ts: applyPaintedRealms extracted and shared")

p = "src/engines/worldgen/cartography/texture.ts"
s = io.open(p, encoding="utf-8").read()
old = """  // Roads and realm borders are left exactly as they were: they are wrong in the
  // painted area until the next full pass, and being wrong for a second beats
  // being right four seconds after every stroke."""
new = """  /**
   * ROADS are left exactly as they were: they are wrong in the painted area
   * until the next full pass, and being wrong for a second beats being right
   * four seconds after every stroke.
   *
   * FRONTIERS are not, any more. They used to be, for the same reason - but a
   * frontier now has a brush of its own, and "wrong until the next full pass"
   * is a description of a tool that does nothing: the 2D draws its political
   * wash and its border straight off this array, the full pass costs nineteen
   * seconds, and it is suppressed for as long as a brush is in the reader's
   * hand. So a painted overlay is laid on a COPY here, at one pass over the
   * grid - a couple of milliseconds, and only for worlds anyone has painted.
   *
   * The copy is the point: `realmBorders` and `realmTint` cache on the array's
   * identity, so a fresh array is exactly the signal that the line and the wash
   * have to be re-derived, and an unpainted world keeps handing back the same
   * array and paying nothing.
   */"""
assert old in s, "patch comment anchor not found"
s = s.replace(old, new, 1)
old = """  const realms = base.realms.map((r) => {
    const n = ren[`realm:${r.id}`];
    return n ? { ...r, name: n } : r;
  });
  return { ...base, settlements, ruins, features, realms };"""
new = """  const realms = base.realms.map((r) => {
    const n = ren[`realm:${r.id}`];
    return n ? { ...r, name: n } : r;
  });
  let realmOf = base.realmOf;
  if (world.painted?.realmCells) {
    realmOf = base.realmOf.slice();
    applyPaintedRealms(world, realmOf, realms);
    // And the towns go with the ground. A settlement whose province changed
    // hands has to answer the hover readout, the realm name and the gazetteer
    // with its NEW flag, or the map says one thing and the panel another.
    for (const s of settlements) s.realm = realmOf[s.y * W + s.x] ?? -1;
  }
  return { ...base, settlements, ruins, features, realms, realmOf };"""
assert old in s, "patch return anchor not found"
s = s.replace(old, new, 1)
m = re.search(r"import \{([^}]*)\} from '\.\./core/settlements';", s)
assert m, "settlements import not found"
if "applyPaintedRealms" not in m.group(1):
    s = s[:m.start(1)] + " applyPaintedRealms," + m.group(1).rstrip() + "\n" + s[m.end(1):]
io.open(p, "w", encoding="utf-8").write(s)
print("texture.ts: patch applies the overlay")
