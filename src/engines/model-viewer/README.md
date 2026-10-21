# Local 3D models

Import one GLB, glTF 2.0, FBX, OBJ, STL or PLY model. Select its local buffers,
MTL files and images together, or use **Import folder** for a directory with one
model and nested resources. The installed Three.js loaders parse the model;
the product converts it to a self-contained GLB for ordinary viewing, tool
blocks, archive and project portability. No reference file is downloaded from
the internet.

The original source files remain attached to the same model record. **Download
GLB** exports the normalized model. **Download originals** returns the original
file, or a ZIP containing unchanged source files and relative resource paths.
Old GLB records need no migration. Cloning remaps the model identity and carries
all source bytes. Archive/restore preserves the same payload.

An OBJ with an MTL keeps its supplied materials. A single PNG/JPEG/WebP/AVIF
selected beside a plain OBJ, STL or PLY supplies its texture; missing UVs get a
planar projection on the mesh's two largest dimensions. Embedded FBX and glTF
textures are resolved by their loaders. The pre-existing bounds remain: 25 MB
per selected source set and per normalized GLB, 100 MB of models and originals
per project. Draco, Meshopt and KTX2 compression remain unsupported; loader
format/version limitations produce an import error without writing a model.

Orbit, pan, zoom, framing, wireframe, lighting and animation controls remain.
Focus the viewport and press **W** for flight: WASD, Space up, Shift down,
pointer drag to look, R to frame, Escape for orbit. The camera selector and six
direction buttons provide the same movement without shortcuts. Releasing a
key, blurring the view or hiding the page releases held movement. Compact
model blocks rotate automatically unless reduced motion is requested; users
can pause rotation. Closing the view releases frame callbacks, input listeners,
textures, geometry, skeletons and the WebGL context.

## Product operations

`MODEL_TOOLS` in `bridgeManifest.ts` and `MODEL_HANDLERS` in `bridge.ts` expose
`wh_model_list`, `wh_model_get`, `wh_model_import`, `wh_model_export` and
`wh_model_remove`. Import accepts named local base64 files and uses the same
conversion/persistence as the UI. Lists omit binary data. Get includes bytes
only on request. Export supplies portable GLB or original sources. Removal uses
the normal Document archive. Every operation resolves the owning project.

## Verification

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
node node_modules/electron/cli.js tests/model-viewer-depth.runner.cjs
node node_modules/electron/cli.js scripts/run-model-viewer-tests.cjs
```

The depth suite creates all six formats, real PNG textures, nested resources
and a larger binary buffer locally. It decodes the resulting GLB geometry,
checks original ZIP bytes, missing-resource failures, clone/archive roundtrips,
all five registered native bridge dispatches, actual focused camera events and
the multi-file UI. The runner uses an isolated Electron profile, disables the
network and compiles current application CSS for desktop and narrow captures.
The legacy suite covers GLB containers, animation, context loss, abort and
resource disposal. Native MCP transport is a separate integration check owned
by the task coordinator; dispatch tests alone do not claim that transport.

## Reading and standalone HTML

Linked models remain interactive in normal ReadingView, standalone Reader HTML
and offline wiki HTML. They share the editor's Three/GLTFLoader viewport, with
orbit/pan/zoom, reset, lighting/wireframe, fly controls, animation selection and
play/pause, and opt-in automatic rotation. Hidden/filtered/offscreen readers
pause their loops; removal/page exit/context loss disposes GPU resources.
Loading or unavailable WebGL has an explicit retry action.

Only the normalized self-contained GLB travels into the reader; original source
bundles do not. Project and explicit-era resolution happen before hydration or
export. Wiki entry/hidden-block exclusions apply before model payloads are
collected; `includeMedia:false` omits model payloads and their runtime. The image
option controls separate raster images, not textures intrinsic to an admitted
GLB. Files without models keep their previous restrictive offline CSP.

`scripts/build-model-reader-runtime.mjs` compiles the authored `offlineEntry.ts`
to an ignored text asset during postinstall and Vite configuration. Both Vite
and native esbuild consume the same real asset lazily, so other source runners
need no virtual-module shim. Standalone exports inline that trusted local code
once and contain no application/database dependency, remote decoder, CDN or
companion file. The asynchronous wiki loader prepares the runtime; its existing
synchronous builder consumes that prepared data. The normal Reader builder is
already asynchronous. Native `wh_reader_export` and `wh_wiki_export` use those
same builders, including explicit era and wiki presentation/exclusion options.

```powershell
node node_modules/electron/cli.js tests/model-reader.runner.cjs
```

This isolated offline Electron test creates a local textured animated castle,
executes normal Reader/wiki native dispatch for Base and a distinct era, saves
four actual HTML files and reopens them with HTTP disabled. It checks exact GLB
bytes, real pointer orbit, reset/animation/rotation pixels, paused frames,
visibility and GPU disposal, deliberate WebGL failure/retry, and desktop/narrow
captures. It also mounts actual ReadingView in both scopes; stable sanitized
prose prevents metadata rerenders from erasing hydrated blocks.
