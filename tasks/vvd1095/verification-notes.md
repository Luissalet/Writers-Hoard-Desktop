# Optional rich notes — task1095

Source `0a90dd40f18361a0ae67e87923bb8890cccf24d6`, integrated by root after independent CAS9 approval. Task1095 remains open. This record covers the optional rich-note delta, not the concurrent atlas-to-card work, universal parity or an installed-app update.

## Actual reference and Writer flow

Root used the authenticated Brave reference Notes0.1.6 in the existing world, with a synthetic QA note. The initial title attempt affected the catalogue preview during an asynchronous panel transition; it is not accepted as saved-document evidence. Root then edited the actual note through slash Heading2 and Bulleted list, closed/reopened it and confirmed the title, heading and two items survived. Images/cover/other slash controls were visible but not exercised. `_stage/notes-rich-next/REFERENCE-root.md` and `_stage/live-next/vvd-rich-note.png` retain that evidence.

Root's normal Writer Brave QA project `proj_mvl51nyx_tl1a8w` first reproduced the plain-body limitation. After the change, root edited the existing plain note, selected Rich text, used slash Heading2/Bulleted list and Save changes, waited for the editor to close and reloaded. The saved QA Writer1095 — nota enriquecida retained the heading/list. Copy returned exactly three lines:

```text
Pistas del puerto
Revisar el faro
Hablar con la capitana
```

Search for capitana showed only the rich note. Enter capture created a separate plain QA note and Rich text remained off. Root owns these Browser/clipboard interactions; this documentation pass inspected the saved screenshot `_stage/notes-rich-next/writer-rich-saved.png` and reports, without repeating the flow. The screenshot alone does not establish reload timing, clipboard content or every Tiptap control.

## Native contract

- `Note.richHtml` is optional sanitized Tiptap HTML; `text` remains its coherent plain projection for search, AI context, clipboard and existing clients. Old notes remain plain, without read-induced migration or writes.
- Rich writes regenerate text; text-only replacements clear previous richHtml; metadata-only writes retain formatting. `richHtml:null` selects plain mode while preserving the plain projection. Normalization is idempotent through hooks, operations and the native bridge, including era paths.
- Composer and NoteCard use an explicit Rich text checkbox and the existing Tiptap editor, with normal Save/cancel. Rich composer Save returns quick capture to plain; Enter and bare/global capture retain their old plain behavior. Existing title/cover/source/tags/pin/inbox/scope behavior remains.
- Existing MCP create/update/list names remain: create keeps its required text and adds optional richHtml, update accepts richHtml string/null, list returns optional HTML alongside text. Existing native Undo restores the rich/plain pair and optional-field absence; era writes/Undo preserve Base.
- Imported rich rows are sanitized again on read. Captured wiki exports retain admitted headings/lists/local raster images and cover with the DB closed; images-off removes inline images and cover. Hidden/spoiler/admission policy applies before publication, without foreign cached captions or external-image fallbacks. Common semantic preview admits H1–H6, not new interactive block behavior.
- Rich note document-image export uses the existing prose source pipeline; the legacy plain branch remains. Tests verify the document-image source, not a visually inspected rendered PNG. JSON, clone and real ZIP delete/restore preserve the complete row and local images without a new format.

## Tests and independent review

Author receipts in `_stage/notes-rich-next/RESULT.md`: 17 focused group invocations passed — contracts2, UI3, portability2, legacy capture4, legacy wiki4 and manifest2. Renderer typecheck and production lint passed. Original `contracts-red.log` proves the native create dispatcher previously ignored richHtml; it remains retained. Initial lint/types and fixture sequencing/scope mistakes are separately documented and not relabelled as product REDs.

Independent review repeated overlapping areas and added its own oracles: 26 focused groups passed — contracts2, UI3, portability2, capture4, wiki4, tool-blocks7, own null/Undo/era/import/privacy checks2 and Node manifest2. These runs overlap the author's tests and earlier suites; they are not added into a new full-suite total or attributed to this documentation pass. `_stage/notes-rich-next/REVIEW-independent.md` records the exact scope and limits.

CAS9 checked exact commit `0a90dd40f18361a0ae67e87923bb8890cccf24d6`, 17 committed paths and 16/16 matching frozen source/oracle hashes. Four test exports retain their normal runner registrations. The reviewer did not repeat immutable tests solely for the commit/vote; `formal-r9-vote.md` and `formal-r9-hashes.json` distinguish formal verification from earlier executions. No blocking finding remains in this notes delta.

## Final validation boundaries and next work

Root integrated this source commit and completed clean-main verification under the integration lock. `_stage/notes-rich-next/main-verify-locked.log` records successful renderer/Electron typechecks, shipping lint with zero baseline fingerprints and conformance (34 engines, 64 engine tables, 6510 locale keys, 22 locale files, zero known warnings). `main-build.log` records successful Vite production build in 1m18s, Electron bundles and the two plain-Node manifest/schema checks with 931 tools. These are root's receipts, not executions by this documentation pass or 931 end-to-end tool tests.

Earlier attempts remain separate failures: `main-verify.log` has TS2307 for absent `@huggingface/transformers` in two workers; `main-verify-final.log` has TS2322 in BoardCanvas after a package install resolved dependencies beyond the lockfile. Root restored exact locked dependencies with `npm ci --ignore-scripts`, then obtained the successful locked receipts above. Package/lock SHA values remained unchanged; no source fix or model/service change is attributed to this recovery. Neither failed log is relabelled PASS.

The author's Node receipt reported 931 tools. The peer's two Node checks ran in a working tree reporting 932 because concurrent atlas work was present outside this notes commit; they establish import/schema behavior for that working tree, not a clean-SHA catalogue of 932 or approval of atlas. Root's final clean-main build separately confirms 931. No atlas-to-card capability is elevated to PRESENT by these notes receipts.

Later, the separate atlas commit `ff3baead8149aefa03c3ba0c9ead6875eb6bc6b0` received CAS10 and its own clean-main 932-tool build; see `verification-place-cards.md`. Root's subsequent native manual update covers both source SHAs, adds607characters and preserves197other paragraphs/all paragraph styles in198total (`_stage/world-card-next/manual-receipt.json`). These later receipts do not retroactively expand the earlier notes peer's review scope.

Current-source native dispatcher checks do not certify a new final-source stdio transport: the existing host remains cached and its rejected restart is not bypassed. Source delivery does not migrate a real profile or update the installed executable. No claim covers every Tiptap button, interactive embeds, unexercised reference media controls or universal note parity. Continue the other observed offline gaps; task1095 is not closed by this delivery.
