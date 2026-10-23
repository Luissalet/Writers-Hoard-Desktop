# SDK measured levels and stereo pan — integrated fcf94f6, CAS20

Task1095 / Agora1195. Source `fcf94f61a99a7541ac4029916e023f7405e3a14d` is independently approved CAS20 after a fresh task read and vote, and integrated FF-only from main07f6777. Exact-main verification/build completed in root session58713 with exit0, including Vite43.33s and Electron PASS. Task1095 remains open for continued web/SDK comparison excluding external APIs/payments.

## Current procedure state

| Gate | State at documentation handoff |
|---|---|
| Implementation | Commit13 routes:11 author freeze (9 product +2 tests), independent oracle and runner registration of11 exports at180000; no removed registration |
| Author focal checks | Seven new functional groups GREEN; renderer types/lint and Node manifest checks pass |
| Root normal Brave | Loop/PCM L-R/pan/zero/Stop/save/reopen verified on the frozen source |
| Independent review | APTO and29 unique groups PASS:7 author +4 own +18 legacy checked against final source |
| Source commit / formal CAS vote | Exact fcf94f61a99a7541ac4029916e023f7405e3a14d approved CAS20 after fresh revision20 read, byte check and accepted vote |
| Main integration | Complete: exact FF07f6777→fcf94f6 |
| Exact-source main verification/build | Complete, root session58713 exit0: verify:quick34/64/6515/22/0 warnings; shipping lint0; renderer/Electron types PASS; Vite43.33s; Electron PASS; Node937 tools/schema2 checks PASS; original Node author-kit4 scenarios plus headless assertion PASS; main clean and merge lock released |
| Native manual update | Complete:415 UTF-16 units, requiredRevision/readback,198 paragraphs,197 other texts and all styles preserved; both locks released |
| Continuity and documentation | MEMORY appended with prior bytes intact; only the existing own graph node updated with embedFalse, other nodes/edges preserved. Documentation integration is recorded in Agora1195 |

The source integration, CAS20, exact-main verification/build and manual have their own receipts; earlier7c/d542/043 receipts are historical. The author prepared four explicit documentation routes in `_stage/sdk-audio-levels-next/docs-paths.txt`; root added eight capability/bridge/matrix/tracking routes without creating an examples README. Continuity evidence is `_stage/sdk-audio-levels-next/continuity-receipt.json`; both continuity locks were released. Main evidence is `_stage/sdk-audio-levels-next/main-receipt.json`. Manual evidence is `_stage/sdk-audio-levels-next/manual-receipt.json`, naming exact source/CAS20 and successful requiredRevision/readback.

## Contract and reference boundary

The primary [SDK HostServices table](https://docs.beta.vvd.world/workshop/reference/sdk#hostservices) lists spatial/getLevels and audio hooks without complete parameters/results. Writer adds its own scoped contract, not identical upstream signatures. Source research in `_stage/sdk-audio-levels-next/GAPS.md` distinguishes existing microphone RMS/silence detection, file waveforms, Soundscape gain and wiki-map distance ambience from the SDK playback gap. Those consumers are not rewritten or relabelled absent.

LocalToolAudio.getLevels(handleId) returns detached finite digital RMS/peak for the current own voice, left/right and aggregate, or null. Measurement is post-effective-gain/bus/duck and post-pan from actual channel analysers. Stereo splitting avoids antiphase cancellation from mono downmix. It is not effectiveVolume, file-waveform normalization, microphone input or speaker/SPL evidence; internal samples may exceed1 and are not hidden by API clipping. Aggregate RMS uses channel powers, peak the maximum channel peak.

Active silent PCM or volume0 returns measured zeros. Absent/stopped/foreign/revoked/unavailable handles return null; a suspended production context also returns null. Reads do not create/resume context, start playback or enqueue sound. A recording fake defaults to null, rather than deriving fake signal from volume.

Pan is finite[-1,1], default0, in play/update/current state: left/centre/right by a real StereoPannerNode. Explicit stereo preserves prior centre output; correlated stereo can change peak amplitude when panned, without a constant hardware-loudness promise. Backend without stereo keeps old default0 playback and explicitly rejects nonzero before affecting valid playback. No3D/listener position, distance attenuation or HRTF was specified or implemented.

The opt-in useLocalToolAudioLevels hook samples only the selected active handle while visible, removes its RAF/subscription on retarget/unmount and never renders a former binding's measurements. Real node cleanup disconnects source/gain/panner/splitter/two analysers and releases decoded buffer/end handler on teardown. Revoked preparation cannot start late. This keeps prior exclusive/abort/resume/source-version and lease semantics.

SoundPad is the existing Local sounds Owned example; no automatic install or source reexport change. L/R metrics and pan reuse existing themed controls, Play music and Stop. Volume/pan are runtime, without a DB field/CAS/history/Undo addition; saving retains the owned block, not these transient controls. Readonly projections do not mount authored playback controls. The public [API section](../../docs/local-tool-sdk.md#measured-audio-levels-and-stereo-pan) gives usable method/hook examples.

## Native MCP correspondence

Existing `wh_local_audio_status` gains optional `includeLevels:true`, with measured `levels` or null per active same-project/era handle. Default response omits levels. Existing `wh_local_audio_control` adds action pan with required active scoped handleId and finite pan[-1,1]. It updates the same handle, not a future voice or another scope. No new tool-count uplift is inferred.

Play remains started:false,queued:false,gesture-required for both old media IDs and source/slot/hash references. The native registered dispatcher is tested against real clients, not response arrays. An already-running stdio host caches prior source; no final-source stdio transport, autoplay/queue or physical speaker proof is claimed.

## Root normal Brave flow

Source: `_stage/sdk-audio-levels-next/REFERENCE-root.md`, actual Brave QA project proj_mvl51nyx_tl1a8w, card QA Writer1095 — audioSDK, explicit reload without HMR/desktop/host restart. Existing AssetPad image/default/controls remain after043. Root inserted Local sounds Owned through References and document tools → Source blocks.

Mount was Stopped/No active measurement. With imported qa-bell.wav, volume15% and normal Play music gesture, a loop stayed Playing with measured L/R RMS/peak. Pan Home=-1 made right0; Pan End=+1 made left0 on the same reproduction without another Play. Volume Home=0 kept Playing with both channels0.000; Stop returned Stopped and dash/no active measurement. Signal/window values vary; an immediate snapshot can show the previous PCM window before the next frame, without proving failure.

Root inspected writer-pan-left.png and writer-volume-zero.png. Save completed and closed the modal; the saved block appeared in About. Edit/reopen returned15%,pan0,Stopped/No active measurement, with no autoplay or retained samples; Cancel closed without a draft. This is normal UI evidence attributed to root, not this documentation author or a hardware-hearing/SPL claim. The short AssetPad tick is not used to require sustained Playing.

## Focused checks and honest attribution

Author final seven exports,180000ms each through the existing runner; logs final-<export>.log under stage:

| File | Export | Groups |
|---|---|---:|
| tests/local-tool-audio-levels.browser.tsx | testAudioLevelsCapability |1|
| same | testAudioMeasuredPcm |1|
| same | testAudioNativeLevels |1|
| same | testAudioLevelsLifecycle |1|
| same | testAudioPreparedCleanup |1|
| tests/local-tool-audio-spatial.browser.tsx | testAudioStereoPcm |1|
| same | testAudioLegacyBackendPan |1|

Real OfflineAudioContext/Analyser and programmed suspension test actual PCM post-gain/pan, silence, bus gain, stereo/antiphase and per-owner isolation without a physical device. NativeLevels mounts actual SoundPad in StrictMode with native client/DB/registered dispatcher and the real offline voice graph. Lifecycle uses explicit inert test values only to inspect subscription/RAF/binding behavior, not signal proof. PreparedCleanup instruments real nodes and buffers on revoked prepare. Diagnostic inspectOfflineAudioAnalyser established feasibility before implementation and is not an eighth acceptance group.

Existing regressions actually run by the author: testLocalToolAudioEngine2 + testLocalToolAudioClients4; five intact previous independent audio exports (registry, retarget, failed exclusive, exclusive race, resume failure); d542 asset audio bridge1 + native asset clients6. These18 prior groups are separate from seven new level groups, not a global suite or proof of new independent review. They ran before the final node-buffer cleanup; final new graph tests ran after it. Preserve this chronology rather than claiming every old check was repeated after each byte.

Final renderer types and affected9-source lint exit0; plain Node manifest remains937 tools with2PASS. These author receipts are distinct from root's completed exact-main verification/build. The separately integrated043 author-kit fix has original Node4 scenarios+headless and17 overlapping renderer groups; those are documented in [resource verification](verification-sdk-assets.md#later-technical-correction-headless-author-kit-043e906--cas19), not added to these counts. Root also repeated the original Node4 scenarios plus headless assertion on final main, all PASS.

## Final independent review and formal CAS20

`_stage/sdk-audio-levels-next/REVIEW-independent.md` and review-final-receipt.json record **29 unique functional groups PASS**:7 author +4 independent +18 legacy. The reviewer repeated the18 regression groups against the final source, rather than relying on the author's earlier pre-cleanup runs. No global suite or repeat-count inflation follows.

| Independent export | Evidence |
|---|---|
| reviewAudioVariablePcm | Periodic nonconstant real PCM; analytical RMS/peak, channel-power aggregate, volume/bus/duck, antiphase and values over1 without clipping; fade cleanup |
| reviewAudioNodeFallback | Real graph without panner/analysers preserves default stereo playback, reports null levels and rejects unsupported nonzero pan atomically |
| reviewAudioMeterVisibility | Real hook/StrictMode with explicitly inert fixture checks hidden/visible sampling, revocation and unmount without stopping playback |
| reviewAudioSuspendedRead | Production backend plus OfflineAudioContext graph with a controlled state facade: real running samples, null suspended/closed, no context construction/resume from reads, Stop clears samples |

The fourth test's facade controls backend state for the read-gating oracle; it is not proof of a physically suspended audio device or a hardware measurement. Warnings and the existing split of author's measurements/fixtures remain documented.

Formal receipt review-formal-task-before.json retains the new revision20 read before checking/voting. review-formal-bytes.json verifies13 paths, eleven frozen hashes plus intact peer oracle, exact commit/index/source blobs (EOL normalization only), and runner11 registrations with no removals. review-formal-receipt.json accepts approve for CAS20 and the exact SHA; it does not inherit CAS18 or19. Root then integrated FF07f6777→fcf94f6. Manual receipt records415 UTF-16 units and paragraph/style preservation, with both locks released. Exact-main session58713 exited0: verify:quick34 engines/64 engine tables/6515 locale keys/22 engine locale files/0 warnings, shipping lint0, renderer/Electron types PASS, Vite43.33s, Electron PASS, Node937 tools/schema2 checks PASS and original Node author-kit4 scenarios plus headless assertion PASS. Main was clean and the merge lock released; no push.

Preserved author failures: red-capability.log (API absent before product change), native-ui-first.log (MCP pan did not refresh normal slider), prepared-cleanup-first.log (revoked prepared source retained decoded buffer), types-first.log (transient duplicate silent getter and undefined hook state). Each corrected case retains its original log; final tests/types pass. React act and bundler warnings remain visible where logged, not hidden or inflated into acceptance checks.

Task1095 remains open for the next reference comparison; the shared-world manuscript architecture is discussed in Agora1451. Completed exact-main build evidence does not certify final-source stdio transport, universal SDK parity,3D or hardware quality.
