# Native SDK resources — integrated d542365, CAS15

Task1095 / Agora1195. Source commit: `d542365275234e43470a5a0c58c1a1a9b11a6698`. Independent CAS15 approved; exact source is integrated and its final main verification/build and manual readback passed. Task1095 remains open for further observed offline reference gaps.

## Final receipts

| Gate | State |
|---|---|
| Source implementation and focused author checks | Complete on the final38-path author freeze |
| Independent technical review | APTO; final receipt38/38 hashes,34 distinct focused groups |
| Formal submission CAS | CAS15 APPROVED by codex-writer1095-final-review |
| Main integration under merge lock | Exact FF f44e387→d542365, fresh lock and HEAD check; main clean, merge lock released |
| Final verification/build on that integrated main source | verify:quick PASS34 engines/64 tables/6515 keys/22 locale files/0 warnings; shipping lint0; Vite28.92s/Electron/Node937+schema2PASS; root session2655 exit0 |
| Native manual update | Google:588 added UTF-16 units, requiredRevision/readback,198 paragraphs/197 others unchanged/all styles preserved; both manual locks released |

Documentation scope is the ten explicit paths in `_stage/sdk-assets-next/docs-paths.txt`; source/test/runner/Git/manual/MEMORY are outside this documentation pass. Final source/build receipts above belong to this integration, separately from earlier7c/audio or calendar builds. Google manual evidence is `_stage/sdk-assets-next/manual-receipt.json`; this documentation pass did not modify the manual. Its requiredRevision write and final readback confirm the exact source, paragraph/style preservation and released locks.

## Implemented contract

Optional definition `assets`/`assetFiles`, a shared native resolver, typed local refs and owned AssetPad. Manifest slots declare path/kind/meta/replaceable/accept/aliases; compiled release bytes and size are checked against its file manifest. Alias names are canonicalized within each Base/era layer before merging. Missing/hash-mismatched resources stay unavailable, without silent fallback to another package.

Selection is document → installation → shipped default. Installation persists in existing localToolStates/contracts under writers.host-assets, not a new store; named eras save differences and Revert restores Base inheritance. CAS observes Base, own layer, scope and release identity. Reads create no state. The name is reserved only for state integrity, not a new permission.

Installation supports **CAS+Revert, without Undo**. Independent source documents declare assetOverrides and receive existing state.apply Undo/Redo receipts; tests cover wrong-document receipt retarget and stale opaque CAS. Owned blocks retain their existing native block read/apply/undo/redo APIs. The new wh_local_asset_override documentId is a source-document ID, not a blockId. No second history or blanket Undo guarantee was added.

Refs distinguish gallery image IDs, effective media IDs and logical source/slot/hash. Omitted hash follows the effective pin; explicit hash selects that exact compiled release of the same namespace even if another is the current pin. The current client lease is still checked. Package backup import executes no source. At this historical d542 cut, font/data had shipped Blob defaults without a generic replacement picker. The later file-import extension is documented separately below.

Normal AssetPad is available through an already compiled/installed Initiative source's Owned block menu; it does not automatically install that example. It includes bundled local SVG and synthetic WAV, per-document/per-installation image/audio selectors and Revert. Play/Stop use existing scoped SDK audio at15% with a real user gesture, without mount autoplay. Compiled small data URLs are decoded directly instead of fetch, preserving the app's existing CSP. ObjectURLs are owned/revoked per hook and stale bindings cannot allocate a late URL.

Readonly previews resolve declarative image requests, not authored components or controls. Captured Reader/wiki use the same snapshot, including referenced images inside nested child/parallel-draft blocks, with no DB-live fallback. Only referenced gallery images are captured, not the whole gallery. includeImages/excludedImageIds govern images separately from includeMedia for media. Clone/JSON/ZIP preserve bytes and remap image/media domains separately, including repeated/same-string IDs.

Normal readonly SVG and raster preview frames are96×96. Compiled SVG passes through safeToolSvg; arbitrary manuscript SVG/script remains excluded. Wiki resanitizes SVG with its existing width100%/max-height360px frame; a wrapper's style is discarded. That wiki sizing remains a documented limit; no global SVG/CSS policy was expanded.

## Native agent surface

- `wh_local_asset_slots`: manifest and effective/own installation overrides with CAS version.
- `wh_local_asset_resolve`: document/explicit-map cascade and honest availability/kind/MIME/size/version/origin/ref, without Blob or ephemeral URL.
- `wh_local_asset_override`: installation CAS+Revert or independent source-document CAS state action/receipt. Validates aliases/type/MIME/replaceable and current scope.
- Existing `wh_local_audio_control.play` accepts source/slot/hash ref alongside the previous assetId. It validates and returns started:false, queued:false, gesture-required, without playing or queuing audio. Status/Stop/buses remain scoped SDK-owned playback; legacy Soundscape/Reader graphs stay separate.

Exact fields and native API examples are in [SDK](../../docs/local-tool-sdk.md#native-packaged-resources-and-slot-overrides) and [AI bridge](../../docs/AI-BRIDGE.md#recursos-de-herramientas-locales-fuente-d542365). These are Writer's own additive signatures, not universal VVD SDK parity.

## Root's normal Browser evidence

Source comparison uses the primary SDK contract for appAssets/asset manifests/hooks, not an unperformed reference-UI claim. Root's normal Brave verification is `_stage/sdk-assets-next/REFERENCE-root.md`, project `proj_mvl51nyx_tl1a8w`, Writer QA63395 and card QA Writer1095 — audio SDK. No desktop control or host restart was used for this flow.

Root inserted Asset pad Owned through Edit Entry → Source blocks and saved the parent. Initial TypeError: Failed to fetch and missing portrait were real: Vite inlined SVG into data URL while connect-src rejected fetch(data). A pure decoder fixed the default and admitted gallery paths without expanding CSP.

After deliberate reload, default portrait and tick resolved. Root imported PNG through Gallery/Choose File/Adjust image/Attach and WAV through Sound and video. Installation tick changed origin to installation; document tick changed it to document; Revert document recovered installation and Revert installation recovered the package. Saved/reopened About showed the gallery image without controls. Final styled Play/Stop are separated/bordered and selectors/Revert show their disabled states. The very short synthetic tick was already Stopped by later snapshots; no sustained Playing or hardware-hearing claim is inferred.

An initial About probe queried only IMG and incorrectly suspected absence of the SVG default. Root corrected that claim; it is **not a product RED**. Separate real size mismatch was captured: SVG used a full-width360px frame while PNG used96px. The bounded renderer fix and final root observation confirm96×96 after the modal animation settles. A transient91.2px measurement during0.95 animation is not the settled size.

Final captures in stage: writer-gallery-reading.png; writer-controls-visible-final.png; writer-default-reading-final.png. Earlier writer-default-fetch-red.png and writer-default-reading.png retain the actual loader/size failures. writer-controls-final.png is an earlier wrong viewport and does not prove the controls. Full attribution remains in REFERENCE-root.md.

## Focused verification and preserved failures

Independent final technical receipt/review: `_stage/sdk-assets-next/REVIEW-independent.md`, review-final-receipt.json and review-final-hashes-after-confirmed.json. **34 distinct functional groups** =18 author +6 independent +10 relevant legacy. Repetitions are not extra groups; no global test suite is claimed.

| Source | Exports and groups |
|---|---|
| Author, tests/local-tool-assets.browser.tsx | testLocalToolAssets6; testLocalToolAssetEdges3; testLocalToolAssetAliasRevert1; testLocalToolAssetDocumentUndo1; testLocalToolAssetAudioBridge1; testLocalToolAssetCompiledUrls1 |
| Author, tests/local-tool-assets-portability.browser.tsx | testLocalToolAssetPortability4; testLocalToolAssetCodexReading1 |
| Independent, tests/review-local-tool-assets.browser.tsx | reviewLocalAssetGalleryCsp1; reviewLocalAssetConcurrency2; reviewLocalAssetCapturedDrafts1; reviewLocalAssetCloneCollision1; reviewLocalAssetAbout1 |
| Relevant legacy repeated independently | testLocalToolCodecPortability2; testSourceBlockPortability2; testReaderSoundtrack6 |

Actual native clients/registered dispatcher, real React hosts/StrictMode/CodexReadContent, CAS races/lease aborts, live gallery refresh, real CSP, clone/ZIP and DB-closed Reader/wiki are exercised. Audio uses a command backend without hardware. inspectLocalToolAssetWikiFrame only diagnoses the existing wiki frame/wrapper policy and is not another acceptance group. The peer's first CSP execution was after the fix: no independent CSP RED is attributed to it.

Preserved author RED logs include red-capability.log, red-document-alias.log, red-compiled-url-csp.log, red-svg-frame.log and prior Reader SVG pipeline failures. The peer independently reproduced vector size in review-vector-footprint.log and reran the same unchanged oracle GREEN. Two early peer collision assertions used invalid assumptions about ID strings/era IDs; they are preserved as invalid test assertions, not product REDs. An intermediate37/38 hash comparison was the root-requested test-only wiki diagnostic addition; final38/38 receipt closes it.

Author renderer types and affected-source lint exited0 after the relevant fixes; see types-svg-frame.log/lint-svg-frame.log and earlier final/UI/CSP logs. Peer product type/lint are attributed to author receipts; its test ESLint was ignored by configuration and is not a lint PASS. Bundler import.meta/IIFE and legacy React act warnings remain recorded with exit0.

Native dispatcher evidence is distinct from stdio transport: the already-running stdio host caches older source, so this lot has **no new final-source stdio claim**. Browser evidence belongs to root; no speaker/audio-recording proof, autoplay, remote service, AI API or payment is claimed. Final main verification/build and formal CAS15 are recorded above; they do not turn the cached stdio host into final-source transport evidence.

## Later technical correction: headless author kit (043e906 / CAS19)

The original Node author-kit oracle exposed a regression in d542: the public resource-hook module also contained a host-only preview hook, whose dynamic import reached assetBrowser/DB. This was a real import-boundary failure; its RED is retained in `_stage/sdk-author-kit-fix/red-original-node.log`. Earlier34 resource groups did not certify this missing Node boundary check.

Source `043e906` is independently approved CAS19 by codex-writer-cal and integrated FF-only. Four paths only: move useLocalToolAssetPreview verbatim to a host-internal module that the SDK does not reexport, remove that internal hook/import from the public hook module, change the two host imports. Public hook signature/body and readonly preview behavior are preserved. The original CJS/TS oracle and forbidden-input assertions remain unchanged; no plugin, mock, allowlist or code-copy bypass supplies the GREEN.

Root's exact main rerun passes the original Node's four scenario groups plus its headless boundary assertion and verify:quick/conformance/lint0 (session92168 exit0, clean main/merge lock released). Independent structural comparison verifies the unchanged bodies/import-only host changes and four hashes. The peer reran17 overlapping renderer groups: author resource clients6/edges3/portability4/CodexReading1 plus prior independent readonly CSP/captured/About1 each. These are regression coverage, **not17 new resource features or an addition to the historical34 count**; Node and structural checks are separate.

Root's normal Brave reload still shows AssetPad image/defaults/controls. Full receipts are `_stage/sdk-author-kit-fix/review-independent.md`, review-r19-formal-receipt.json and agora-integrated.txt. This kit correction does not itself certify audio levels or change wiki SVG sizing, audio playback, readonly policy or final-source stdio evidence. The later fcf94f6/CAS20 audio-levels source has separate review/integration/manual and completed main receipts in [its verification](verification-sdk-audio-levels.md): session58713 exit0, Vite43.33s/Electron PASS, verify:quick/lint/both types/Node937 schema2 PASS, with the original Node author-kit4 scenarios plus headless assertion repeated PASS. Main was clean and the merge lock released. None of its counts is added to the resource/kit totals here; MEMORY and that documentation commit/integration remain pending.

## Subsequent font/data file extension

The d542/CAS15 baseline and its34 historical focused groups above remain unchanged. Feature source `c2b7cb0dba116485264a8ae86e48635c82706e72`, carried by delivery `416be426337f22f128c5f4d0875167d48738e05c` approved CAS23 and verified on main, adds project-file import/choices, a FontFace hook and portable captured font/data bytes. Normal editable Owned import is covered, including the Browser failure and corrected rerun; the unchanged original image-policy and byte-compatibility oracles were repeated. Installation remains CAS+Revert without Undo. [Separate source, review, root gates and limits](verification-sdk-asset-files.md). No historical counts or earlier manual/stdio receipts are inherited as proof of this extension.
