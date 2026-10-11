# Native document engine implementation

- [x] Own source snapshot of the permissively licensed document core; rename crates and preserve notices.
- [x] JSON lines service with named sessions, complete archives and explicit file operations.
- [x] Build a console-free product executable and publish its transport contract.
- [x] Verify Unicode, assets, import/export, atomic batches and process transport; run core tests.

Success means the real executable accepts repeated requests, preserves Unicode and image bytes after native save/reopen, renders a page and exports DOCX/PDF. Failed batches must leave document, selection and undo intact. No runtime link, source checkout, updater or Git dependency on the historical source.

Verification: 10 own service tests, 243 editing-engine tests, 87 document-model tests, 56 DOCX unit tests plus 94 DOCX integration tests, 66 format tests, 168 layout tests and 23 PDF tests pass (747 distinct tests). PDF verification extracts the actual Spanish footnote text and checks the manual second page. The independent Electron service validates the real executable's JSON lines lifecycle with 14 passing tests against the previous reviewed SHA (f9744339); the final session-only change removes the undo-depth cap; the isolated complete application adds 5 passing checks, recorded by the application agent. The final review fixes cover atomic file replacement/cleanup, the retained encryption password and table column widths/spans. Detailed logs are in `verification-*.txt`; this does not establish universal DOCX fidelity or parity with Word.

Release executable: `native/bin/writer-document-engine.exe`, SHA-256 `4b1eddfc758c7784d35ba43f999916641254e398f6894d71ef25a2e238b64f4f`. Its Windows PE subsystem is GUI (2); callers still launch with `windowsHide:true`. The package includes the four original code notices and four font OFL texts alongside the executable. Root verification covers the final Electron/browser/MCP integration separately.
