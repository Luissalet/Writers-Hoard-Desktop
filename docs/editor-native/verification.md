# Verification and integration

The application change is integrated in Main as `7c52fd1e3940c80ab5b45276f1d5139b050b59a0`
and `b5bbb42657808f3848e71b70c802f47c97cb5ff2`, after the actual shared-copilot
dependency `63f0362081f0d56eeef7c754ed88650b976f836c`.

Agora 347 submission revision 2 was independently approved. Its first review found
formatting caps that discarded valid imported dimensions. The correction retains
positive finite font sizes and line spacing, nonnegative fractional indentation,
finite nonnegative widths, and values outside toolbar presets. Unicode font names
and long width arrays retain their representation. Toolbar presets remain ordinary
choices, and indentation can continue beyond eight steps.

Agora 348 submission revision 1 was independently approved against the original
`b5a67d4b94d7f117b44a5e5e34521022af6cec2f` submission. Its complete tree equals
`7c52fd1`; the later correction changes only editor TypeScript and tests. Native
Rust, the Electron document service, packaging and the build script are unchanged.
The exact reviewed Windows binary has SHA-256
`4b1eddfc758c7784d35ba43f999916641254e398f6894d71ef25a2e238b64f4f`.

| Area | Evidence |
| --- | --- |
| Rust model, engine, formats, DOCX, layout and PDF | 747 distinct tests pass; native/VERIFICATION.json records source receipts |
| Final application critical suite | 383 checks pass after the formatting correction |
| Actual Chromium editor | 26 checks, including outside-preset import/sanitize/reload and mounted indentation controls |
| Document panel | 10 checks, including chapter boundaries, undo and original document preservation |
| Manuscript document MCP | 6 checks, including outside-preset persistence, ordinary undo, Unicode and embedded images |
| Electron service | 14 checks with the real binary, no skips; also repeated on Main |
| Full application | 5 checks with actual preload/IPC, autosave/reload, DOCX picker/import/undo, PNG preview and actual DOCX/PDF downloads |
| Product HTTP and actual stdio MCP | Shared native sessions, catalogue, Unicode, DOCX/PDF and PNG vision; repeated on Main |
| Shipping source | Renderer/Electron typechecks, shipping lint and conformance pass |
| Main build | Renderer built with desktop-relative URLs, all Electron/MCP bundles compiled, reviewed binary and nine resources present |

Independent review also reproduced encrypted-save preservation, atomic writes,
table widths, packaged licences, 650 undoable edits, redo and atomic batch rollback.
The editor reviewer reran 37 checks after reading submission revision 2. These are
independent receipts; they are not counted as additional distinct Rust tests.

Evidence is retained under
`D:/LocalAI/research-inbox/wordcraft-writers-20261011/qa`,
`D:/LocalAI/diagnostics/writers-native-review-20261011` and
`D:/LocalAI/diagnostics/writers-editor-review-20261011`.

Main received the exact reviewed native executable after source equivalence and
SHA verification. Its normal desktop build and development launcher compile the
owned Rust source themselves. The historical asset attribution notice is retained
for licensing; references there to original tools, branding or paths do not describe
Writers' build or shipped interface.

The installed user window was not restarted or replaced. Main source and generated
artifacts are ready for a version built from this source. Tests used private profiles;
the current installation's data, window and model servers were preserved. No push.
The renderer-size advisory remains an advisory, not a claim of meeting the old
4.1 MB total target.

This verifies the implemented workflows, not universal DOCX compatibility, Spanish
proofing, complete source-project parity, or identical Tiptap/native pagination.
HTML remains supported editable interchange; the native archive retains complete
assets and original parts. The later phases are Agora 353 and 354.
