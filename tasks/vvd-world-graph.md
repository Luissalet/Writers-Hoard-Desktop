# VVD derived world graph: implemented and verified

- [x] Integrated Cards/Graph view in Codex, loaded lazily; graph opens the incumbent card detail/editor.
- [x] Indexed name/alias matcher with original UTF-16 ranges, Unicode/accent/whitespace folding, longest-name overlap policy and ambiguity reporting.
- [x] Distinct edges for inferred text mentions, authored card relations, typed reference properties with template labels and project Relationships rows.
- [x] Scope all nodes and edges to the current project; keep inference derived, preserving authored card content.
- [x] Type/tag/source/name filters, one/two-hop exploration, isolated-card toggle and visible node/edge limits with exact omitted counts.
- [x] Deterministic layout, trusted drag and persisted manual positions, portable JSON layout remapping, safe SVG export.
- [x] Worker analysis with cancellation and a pure fallback; omit avatar image payloads from analysis transport.
- [x] Contextual evidence inspector, direct card open, preserved later search/backlink navigation and ES/EN copy.

## Validation

- `tests/indexed-mentions.browser.ts testIndexedMentions` — Unicode/source offsets/ambiguity and 10,000-name indexed scan pass (~56 ms in this run).
- `tests/world-graph.browser.ts testWorldGraph` — five groups pass: provenance/scoping, filters/layout/SVG, rich-content pointers, 5,000 cards and 10,000 edges (~139 ms in the pointer regression run), scoped persistence/failure/JSON clone.
- `tests/world-graph-ui.browser.tsx testWorldGraphUi` — integrated Codex graph controls, caps, alias/neighborhood/type filtering, evidence and direct card/deep-link behavior pass.
- `npx electron scripts/run-world-graph-qa.cjs` — actual module Worker including semantic anchor/live-block references, trusted drag, visually moved card, IndexedDB manual position and native narrow Fit View pass in hidden isolated Electron. Every card remains visible after fitting at720px and stored positions remain unchanged.
- Scoped ESLint passes; full renderer typecheck passed after initial integration.

## Interpretation

A matched name is evidence that a card mentions another name, not proof of an in-world relationship. Shared names remain visibly ambiguous. References to missing cards or other engines are counted, not drawn. Analysis covers the full scoped input; only drawing is capped, with expansion controls and counts. Manual positions live in Project.codexGraphLayout.positions and travel with project backups.

## Authored rich-content pointers

- [x] Extract semantic Codex anchors and live-block identities without DOM/worker dependencies or cached-label matching.
- [x] Keep `reference` provenance, localize link/block labels and preserve distinct inferred mentions.
- [x] Verify arbitrary labels, stale fallback text, escaping, inert HTML, scope and renamed targets; run focused graph regressions.
- [x] Inspect desktop/narrow real CSS with Fit View at changed pane width and update the parity matrix.

`src/services/codexReference/contentReferences.ts` reads only admitted pointer attributes from actual `<a>` and serialized `<aside data-wh-codex-block="true">` elements. It decodes attributes once, honors first-attribute ownership and skips comments, raw-text/inert HTML, escaped examples and malformed quoted tags. It runs in the actual graph Worker without DOM APIs or evaluating HTML. Local semantic links use the same target resolver as editor activation. Missing local endpoints count as unresolved; foreign scopes cannot acquire local endpoints. Repeated authored pointers aggregate by source, target and pointer kind; typed property references keep their separate provenance.

The graph retains the existing `reference` edge kind and uses explicit ES/EN **Text link / Live Codex block** labels supplied through its analysis payload. It never depends on the selected prose or cached block title. Atomic fallback bodies are removed before title/alias inference, avoiding phantom mentions after a rename. The new focused group verifies custom captions, renamed targets, stale labels matching another card, Unicode/attribute escaping, duplicate attributes, foreign owners, comments/scripts/templates and invalid escapes.

The screenshot review also exposed a controlled ReactFlow node issue: rebuilding nodes without dimensions could hide them after selection/drag. Cards now declare their fixed220×74 dimensions; the UI regression asserts the selected node remains visible. The capture harness waits two frames after scrolling before calculating native Fit coordinates, uses a per-run Vite cache, disables broad file watching and bounds page loading. These infrastructure changes avoid stale hit-testing and locked native-build file watchers. Fit changes only the viewport; the test compares saved manual positions before/after.

Final inspected captures: `.impeccable/review/world-graph-desktop.png`, `world-graph-evidence.png`, `world-graph-narrow.png`. Earlier failure evidence stays under `work/world-graph-fit-failure.png` and is excluded from the review image packet. Focused model5/UI2 groups and scoped ESLint pass after the source changes; final integrated gates are owned by the coordinator.
