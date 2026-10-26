# Source Three runtime contract

Dedicated integration test for existing trusted Source authoring. It verifies production Vite code splitting and shared Three identity; it adds no SDK wrapper. The production build is substantial, so this command is intentionally separate from the default critical suite.

From the repository root:

```cmd
tests\local-tool-three-runtime\run-three.cmd
```

This runs the real Vite configuration with one extra test entry and a graph observer, then starts hidden Electron with a fresh private profile and a private loopback HTTP server. Child processes use windowsHide and the BrowserWindow uses show:false. No browser or desktop automation, installed tool changes, real user profiles, server API or external model downloads are involved.

Separate build and native commands:

```cmd
node tests\local-tool-three-runtime\harness.cjs build
node_modules\.bin\electron.cmd tests\local-tool-three-runtime\harness.cjs run --build-root "<exact THREE_BUILD_ROOT printed by build>"
```

Output lives in a fresh system-temp directory named `wh-local-tool-three-runtime-build-*`. Every native run gets another `native-<timestamp>-<pid>` directory and another profile. Only compiled QA output, synthetic data and evidence are written there; no source checkout/dependencies are copied or linked. The repository test directory is not used for generated output or pointers. Retrying native against the same unchanged build is supported; changed entry/author/fixture/config/plugin code requires a new build. A marker and checkout identity prevent accidentally using an unrelated directory.

The real Vite config keeps its existing plugins, aliases, main/quick-note inputs and manual Three chunking. Its existing Reader build plugin may regenerate the ignored `src/engines/model-viewer/runtime.generated.txt` asset as in a normal build; generated/config hashes are recorded. This harness does not patch product code.

The renderer mounts real MainLayout, TopBar, ProjectWorkspace and two different registered Source tools through the normal release resolver/client/document host. Each author has its own literal dynamic imports of core plus OBJ/GLTF/STL/PLY/FBX; there is no fixture cache or fake Three kit. QuickNote has an explicit inert unrelated preload port so MainLayout can mount. Real React production mode is retained; only fixture root mount/unmount uses flushSync.

C01 checks the actual Vite output graph, including the absence of eager serialized Reader runtime. C02 records requests from before author navigation with a fresh profile and cache disabled. C03 starts four imports through two native clicks and holds only the real HTTP runtime response until all calls are in flight; one runtime request and identical module namespaces/constructors are required. C04 repeats native input without another runtime request. C05 parses five own local triangle formats, with a data-URI GLTF buffer. C06 renders two real crosscreation geometries and reads their framebuffer pixels. C07 compares both complete own projects (including Source documents/control) and the pending ledger exactly, then requires projects0/hosts0/probes0 cleanup.

The HTML scaffold is the mount root; the fixture never places a second full-height app below it. Native controls must have a nonzero rect and an in-viewport center. Failure messages include the author, DOMRect, root rect, viewport and scroll; the guard is not bypassed by programmatic clicks.

Before DevTools setup the driver initializes about:blank and proves scripts0/resources0/no own HTTP request. Recorders are then installed before the first author navigation. It retains bounded checkpoints for HTTP listen, app ready, cache/storage clearing, blank initialization, DevTools, navigation, renderer polling and native acknowledgements. Vite child deadline is900s; Electron child300s; renderer maximum180s, within a260s internal driver budget. Window closure cannot cause an implicit successful quit before RESULT is saved; the all launcher also refuses exit0 without a successful RESULT.

Evidence: `BUILD.json`, `vite.log`, child exit metadata, the Vite graph, and each native run's `RESULT.json`, checkpoints, HTTP/webRequest/DevTools logs, native inputs, phases, console, retained snapshots and profile. Runtime errors and assertions remain failures; every failed attempt is retained in its own directory. Cleanup destroys the hidden window, closes the private server and checks the port returns ECONNREFUSED. Process exit0 alone is never a pass.

A passing run requires a completed build, a saved successful native RESULT, exact retained snapshots, verified cleanup and process exit0. Read the evidence for that particular run; this document does not certify a different checkout or later source changes.
