# Dictionary from prose selection

Official changelog13September2026 documents definitions on hover and finding/adding a word from selected prose. Writer already has an inert dictionary-gloss plugin with hover titles, keyboard navigation and tests. Extend that existing dictionary, rather than building another glossary.

Success criteria:
- [ ] Select real editor text and open a contextual dictionary search; navigate an existing word without changing prose.
- [ ] Add/edit through the existing WordForm, draft journal and saveWord operation, exact project/era and existing conflict behavior.
- [ ] Normal MCP search/create/read/save operations share that storage and validate references/CAS.
- [ ] Native desktop/narrow editor selection and save, era isolation, unchanged editor HTML/undo, existing dictionary/script regressions.

Preserve the current workspace and form controls. No server, automatic translation, invented etymology or new language model is involved.


## Verification2026-10-20

Native1440/640 PASS3groups: keyboard selection+Enter opens actual dictionary dialog, scoped hover/search, create word through existing WordForm, original prose and Undo unchanged; normal registered4tool dispatch/CAS, era-only persistence and JSON clone. Full native Enter sequence includes char event; incomplete synthetic keydown/up did not activate native button (failed logs retained). Dialog waits for effective project data before assertion. Final screenshots Temp/wh-codex-properties-ui-AW7VJt/dictionary-selection-{1440,640}.png inspected together. Focused ESLint PASS.

This import path exposed DB initialization cycle: history constructor read registry from DB-dependent adapters before registry initialized. Registry extracted to a pure leaf; no middleware/hash change. Independent two import orders,15kind capture/Blob dedup/rollback, Codex dependency and richContent tests PASS. One older reviewer clone assertion picks among equal-title preimages ambiguously; own independent stage fixture confirms both legitimate versions preserved; frozen reviewer test must be corrected by reviewer, not suppressed.

External MCP verification and aggregate checks remain pending. No committed/integrated claim yet.
