# Editorial content formatting —1041

Extend the existing AdvancedFormatting/normal Tiptap schema and publishing IR. No separate style store or second editor. Existing paragraph indent means left offset; first-line indent is a separate value in em.

- [x] Add inline small caps, block drop cap/first-line indent and styled horizontal-rule scene breaks, preserving HTML/JSON/reopen and normal Undo.
- [x] Extend the incumbent advanced toolbar with compact bilingual controls; preserve existing formatting. Native MCP uses wh_format_writing and wh_edit_writing_document with the same model/commands, revision checks and audit Undo.
- [x] Share a leaf CSS module for editor/Reader/portable HTML/EPUB. Root wires Reader/wiki imports. Sanitizer changes only normalize the new formatting attributes on supported nodes.
- [x] Native DOCX: smallCaps run properties, firstLine indentation and actual framePr/dropCap/lines, plus typographic scene-break text; inspect the emitted OOXML. EPUB carries approved semantic attrs/CSS; HTML/PDF use real composed HTML. Markdown remains a textual fallback and does not promise typography.
- [x] Functional roundtrip/projection/Undo/native dispatch tests; actual toolbar UI at1440/640 with keyboard/pointer and inspected settled screenshots; emitted EPUB/DOCX/HTML and real Electron PDF checks.
- [x] Run appropriate editor/publishing regressions and typecheck/lint. Record exact unsupported cases and evidence; freeze for root's critical tests/review.

Initial audit: AdvancedFormatting has fonts/size/color/alignment/lineHeight/left indent and named styles; no small caps/drop cap/first-line control/ornament. DOCX currently renders bare hr as three asterisks and does not preserve those missing features. EPUB serializer strips generic style metadata. All publishing doors already share composePublishingDocument. The installed docx library exposes native frame/dropCap/lines and smallCaps; implement those capabilities rather than applying HTML CSS to Word.

Root owns ReaderExport/ReadingView/worldWiki, global manifests/index and integration. Authorized source seam: advanced model/extensions/interchange/toolbar, sanitizer advanced attrs only, writing editor factories, publication adapters and minimal ReaderPresentationStyle integration. No DB/history changes, external art, real data, models/services or commits.


Freeze evidence: tests/editorial-style.runner.cjs PASS with actual external stdio→HTTP→executor→IPC→renderer/IndexedDB, Base/era isolation, stale/invalid values and audit Undo. Two functional editorial-style groups +26 editorial-core +2 manuscript-roundtrip groups. npm run test:editor-advanced:26PASS. tests/editorial-style-pdf.mjs normal PDF text/raster:PASS. Actual TiptapEditor at1440/640:PASS native pointer, text selection/numeric typing, menu onchange and native toolbar Undo/Redo. Renderer tsc + scoped source ESLint + own-source diff check:PASS. Full-worktree diff check reports unrelated codex/hooks.ts blank EOF; not changed here.

Known limits: Chromium CSS first-letter may enlarge only the opening quote when quote and initial are split by an inline mark boundary. Preserved failing PDF/HTML/raster in worldcraft1041-editorial-quote-edge.*; no comparison claim against VVD for that markup. Normal shared-span Unicode quote+Á has actual38.4pt initial in PDF. DOCX native cap handles that grapheme and punctuation even across marks; native Word visual rendering not tested. First-line em maps to240twips at12pt DOCX body, not arbitrary current custom font size. Native DOCX drop caps target ordinary p blocks; heading/pre first-letter formatting falls back. Markdown preserves text without typography. No packaged installer/physical EPUB-device/Word desktop UI proof. Full report in projectless work/worldcraft1041-editorial-depth.md.


## Q19 quoted-initial PDF correction — accepted scoped plan

Success before code: retain the original split-mark quote-edge HTML/PDF/raster and unmodified editorial-style-pdf.mjs oracle. Actual Chromium PDF must emit the accented initial above25pt (not merely the quote), preserve exact text and inline marks, and pass multiple opening quote forms plus a combining grapheme crossing mark boundaries. A normal paragraph must retain its bytes and PDF size/pixels. Source Writing/IR/snapshots remain unchanged.

Minimal implementation: in proseStyle.ts add a detached static-HTML preparation function. Select the initial punctuation plus one Unicode grapheme with Intl.Segmenter; extract only that DOM range to a render-only wrapper, retaining existing inline fragments/attrs. A prepared paragraph opts out of CSS first-letter and styles that wrapper instead. manuscriptExport.ts invokes this only in emitted static HTML/PDF after footnote expansion. Existing live ProseMirror, Reader/wiki, EPUB and DOCX paths remain untouched; no source migration, canonical wrapper or second style model.

Verify detached preparation/content/marks/idempotence/source exactness; real PDF text sizes and raster pixels for several quote/mark cases and unchanged normal control; repeat original PDF oracle on newly emitted fix, rich export roundtrips/regressions and existing normal/native external MCP typography tests. No broad authoring34 recapture, new art, commits or model/service changes.


Q19 quote correction frozen: original oracle unchanged FAIL on original PDF, PASS on newly emitted split-mark case. Detached static helper only; four actual quoted/grapheme PDF initials38.4pt + glyph pixels; normal control12pt pixel-identical to historicalCSS. Source/IR/MCP canonical bytes retained and original FAIL artifacts untouched. Native editorial2/quote2/core26/manuscript2 + externalMCP, advanced26, renderer/ElectronTSC/lint/diffcheck PASS. No aggregate rerun, no claim that live Reader/editor/EPUB fallback has been corrected. Proof and fixed artifacts recorded in projectless work/worldcraft1041-editorial-quote-fix-proof.json.
