#931 CAS5 — native shutdown retains its owner until physical closure

Base0fd83e5ea59a67674a425f9ac9d4c7eb91aeea1b. CAS4 was frozen and independently reproduced before editing; REVIEW931-CAS4-LIFESPAN.md and writer-failed-lifespan-witness.py/json remain untouched. Earlier approved code, suites and receipts remain historical evidence. Ownership transferred to codex-fisiones-vitruvius in1032. No integration or activation.

## Changes

- Module retains app/stack/error/stopping after failed cleanup. ON and new native requests reject while closure is pending. context_exited is set before the first exit-stack close; retries invoke explicit app.state.shutdown instead of an exhausted context. Missing callbacks preserve ownership/error. Shield/join protects cleanup from consumer cancellation.
- Four actual factories export checkpointed shutdown: library scheduler/watcher/index/preload/DB; paperwork scheduler/docsvc/client/DB; reading Node; editorial persistent Rust MCP sessions/thread. Kafka propagates client closure failures. The owned wrapper retains HTTPX default/proxy transports AND HTTPcore pool connections before a pool can consume its connection list, advancing only after each physical close succeeds. SDK bytes are unchanged. Session entries/thread references are cleared only after successful joins.
- PublishingService preserves actual worker/PID and reconciles native owners after rejected OFF/global shutdown. Persisted OFF intent does not imply physical OFF. It does not implicitly kill or replace a failed owner. A failed shutdown leaves stdin available for status/retry; EOF retries cleanup only and does not replay native work or writes. A started global shutdown blocks new ON until completion.
- Retry OFF is visible in the existing UI, retains native DOM/drafts and disables automation controls for the retained owner. Origin5174/IndexedDB, fiction, tokens, IDs, native schemas and formats stay intact.

## Focused evidence

- tests/test_publishing_shutdown.py + test_publishing_cancellation.py + test_publishing_fusion.py:14PASS,8.69s, tasks/publishing931-cas5-final-tests.xml. Four real factories: two cleanup failures, same resource/app retained, ON rejected, third OFF physically closes. Resources are actual SQLite, Node, SDK twin/client/loop and native Rust MCP session.
- Final extension of the physical-close group:5PASS,3.84s, tasks/publishing931-cas5-physical-close.xml. Real AsyncHTTPTransport → HTTPcore pool → AsyncHTTPConnection → AsyncHTTP11Connection, with only its network stream synthetic: two failures, retained connection, third physical close and duplicate no-op. Also cancels the consumer during the THIRD close of the actual SDK twin transport: OFF waits with the same app/loop/thread until release, completes cleanup, then propagates CancelledError. No sockets/services/models used by these client cases.
- Production PublishingService bundled by esbuild, real worker/factories and private failure fixture:6PASS, source-httpx-final/receipt.json SHA865fc653c017bf582dedcd0a452f33d3eeb03fc5a6d566ddfaba52945f928475. Four modules fail OFF twice and close on third; whole-host close does likewise; EOF retries two failures and exits after the third actual close. PID remains stable, new work/ON reject, configured OFF is distinct from retained ownership. Last helper-only HTTPcore delta is covered by the physical group and final frozen cases; service control code is unchanged since this receipt.
- npm run test:publishing:transport PASS: unknown submitted writes require reconciliation, read/pre-send failures stay distinct; five retained Range/consumer/OFF/close/disconnect cases; another module progresses and reopens; shared cancellation remains idempotent. No replay.
- Renderer/Electron typechecks PASS; production Vite build PASS40.74s, dist/assets/PublishingEngine-3bzV0iMs.js. The first renderer check found an overbroad .d.ts edit in this work; the signature was corrected and subsequent checks pass. No oracle/source witness changed. Earlier4+9 XML receipts are preserved separately; no universal suite rerun.

## Final frozen package, without Rust compilation

`node scripts/build-publishing-runtime.mjs --worker-only` uses PyInstaller6.22.3, skips dependency setup/npmci and both Rust builders. Existing native binaries/build.json match all four before hashes/sizes exactly. Final build log frozen-build-pool-final.log. Earlier builds/inventories/receipts are preserved and do not certify this final package.

Final worker: 32651903bytes, SHA2562384c3e7bf4f1f6b6c738a984d511c0b2d9ba63c7d1200b338ca8465e5f25c58.
Full distribution: 8476files/582162194bytes. Canonical file inventory SHA256601c383a200bfe0ece263eee9df308e29136ce1bfb91323c402d15a166b68993. Full inventory frozen-pool-final-inventory.json, SHA25682bbb04d41ed83bbb0901fe7b6a3f0ee5789d7d3e33f6259629ef2a566babdbe. The exe hash alone does not certify resources.

Production PublishingService against THAT final frozen executable:4PASS, frozen-pool-final/receipt.json SHA7d887e7f3423cb4a52b855d2c07d967529bff56c9f39448de7e83af0ddea641c. All four modules/automations initially OFF, cold status starts no process; explicit ON/native MCP list/OFF ends each PID. Editorial additionally opens a persistent real Rust MCP session, creates A4 and inspects within the same session_id, then OFF joins it and terminates the worker. No GUI or Rust rebuild.

Final frozen HTTPX/client and real HTTPcore connection-pool retry cases:2PASS, frozen-httpcore-final.log SHAb8e3af27737287c02eb6cd8428edd1c22ab764da66d2af17706a3b521a5f6bb1. Two failing physical closes, third succeeds; duplicate closure does not repeat. This runs installed bundled dependencies through the executable's existing -c dispatch, not source imports. The fault script remains external; production has no failure-injection switch.

Versioned compact receipt tasks/publishing931-cas5-package.json; full private evidence root D:/LocalAI/research-inbox/fusion-candidates-wave3/writer931-close-cas5. Native catalog394 SHA5bbad7e322d5a4a34f767ffd7606c1fb05a54f083df77cc0a65dc07b357cffa5, unchanged; publishing subsystem401 schemas/controls/links unchanged. No SDK edits versus base.

## Limits

Ready for exact CAS5 independent review. This does not certify every library failure, every native format, installed Electron/CUA, full installer, providers/938 live, PDF/X or PDF/UA. Unretryable resources remain owned/error rather than reporting successful OFF. Native binaries, ignored nested venv and synthetic receipts remain inventoried; no denied cleanup was retried. No personal data/env/profile/token, old source, installed app, Hub/Faustus/model/GPU, browser, integration/push/publication was touched. Root owns CUA, real migration, aliases and installation/activation. The separate private QAweb933/932 script was delivered without starting a server.
