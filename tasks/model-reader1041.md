# Interactive models in reading and offline exports

## Success criteria (before implementation)

- Normal reading hydrates the same-project, era-resolved normalized self-contained GLB into the existing Three/GLTFLoader viewport. It is genuine interactive geometry, never a poster substituted for 3D.
- Reader and wiki standalone HTML contain the exact admitted GLB bytes and their own local runtime. Opening a saved file with HTTP disabled renders geometry and supports orbit/zoom/reset, animation selection/play/pause and automatic rotation, without CDN, service, user cache or application installation.
- Hidden/filtered reader models stop animation/rotation; removal, abort, page exit and lost context release RAF/listeners/GPU resources. WebGL unavailable and bad/context-lost models show useful retry/failure UI.
- Foreign-project, omitted wiki entries/blocks and era mismatches cannot resolve model names/bytes. Base and a distinct era retain independent model bytes.
- Existing authoring/import/export controls remain. Native MCP Reader/wiki export uses the same builders and produces interactive offline HTML, with exact model byte and no-network verification.
- Real Electron standalone-file captures at desktop and narrow sizes show the normal model controls and nonblank geometry. Renderer and focused lifecycle tests are necessary; no wide document suite while the history/DB owner reports WIP.

## Plan

- [x] Extract portable GLB validation/asset primitives while preserving existing model exports.
- [x] Add a reusable DOM model reader mount and lifecycle/visibility handling to the existing viewport.
- [x] Add a locally built, lazy, standalone runtime entry; preserve synchronous wiki builder with preload in its existing asynchronous data loader.
- [x] Carry typed validated model payloads through tool previews and normal reading, Reader export and wiki export after sanitization.
- [x] Verify real offline HTML, model controls/time, no HTTP, byte identity, project/exclusion/era scope and native MCP export.
- [x] Inspect desktop/narrow captures, run focused checks and record exact limits/results.

The bundle is authored as normal source and built with installed esbuild; no hand-generated JavaScript string entry, remote decoder or asset dependency. The existing viewport and normalized GLB contract remain the rendering authority.

## Review and verification

Functional sources frozen. The native esbuild text loader and Vite consume a
real ignored generated asset; the first virtual-module approach was removed
after it broke unrelated source runners. Postinstall regenerates the asset in
a clean checkout; no runner stubs or per-runner virtual resolvers are required.

Actual ReadingView QA found that a fresh `dangerouslySetInnerHTML` object on a
metadata rerender erased hydrated models without rerunning unchanged-content
effects. Memoizing sanitized prose fixes this while preserving the prose ref,
Play and other hydration. The real React Base/era views now retain their model.

Four exported HTML files are reopened from disk offline, with embedded texture,
real animation, pointer orbit, button rotation/reset, animated/paused pixels,
automatic rotation, hidden/document pause, removal/context disposal and retry
after context loss/unavailable WebGL. No HTTP attempts. Normal desktop captures
use1280 and940px (the application's declared minimum window); standalone files
also pass390px with no horizontal overflow. Only an intentionally forced WebGL
failure emits its expected console error; the final run has no other errors.

Focused regressions pass: model legacy6groups, Reader Play4groups, Wiki export5
groups, tool-document blocks7groups. Tool-document's preexisting React act
warning is retained in its output, not counted as a product error. Functional
ESLint and diff whitespace checks pass. Parent owns the final global build;
the latest local typecheck contained only coordinated genealogy WIP errors.
No broad document/history suite was run during that owner's DB migration.

Evidence: `.impeccable/review/model-reader1041/EVIDENCE.md`; full actual HTML
files and test results are in the projectless `work/model-reader1041` folder.
No commit or integration by this subagent.
