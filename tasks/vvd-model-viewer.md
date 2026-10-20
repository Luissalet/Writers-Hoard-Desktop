# VVD parity: offline 3D models

- [x] Validate self-contained GLB before parsing; reject network resources, invalid container data and unsupported decoder requirements.
- [x] Save models in Project.modelAssets atomically; import, select, download and delete through direct UI.
- [x] Render with local Three.js, orbit/pan/zoom, reset, wireframe and lighting; dispose GPU resources and show explicit WebGL/load failures.
- [x] Verify genuine rendered fixture, persistence, controls, invalid input/no-network boundary and lifecycle cleanup.

Design: an additive Operate surface within Writer's existing charcoal/gold design, direct import action and named controls alongside a large model viewport. No remote catalog or model service.

Verification: node scripts/run-model-viewer-tests.cjs passes six browser groups with real WebGL pixel checks and offline networking; generated castle fixture includes animation. Verified StrictMode startup, model imports/download and JSON export/import, explicit WebGL failure, GPU context loss, abort during parse and shared-resource disposal. Current app CSS compiled for desktop/narrow screenshots and visually inspected. Focused ESLint and renderer typecheck pass. Conformance passes 29 engines and localized model metadata.
