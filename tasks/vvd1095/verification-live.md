# Live website and SDK continuation — Writer1095

This batch follows main `abe57c35ad8b0a8380a6ae0c26699441adf5e5cb`. It implements native capabilities; it does not update the installed executable or claim universal reference parity. Task1095 stays open. No push, external API, paid service or model was used.

## Actual reference observations

On23October2026, Browser claimed Luis's existing authenticated Brave tab1069624653 at `vvd.world`, world Souls. A generic tab binding had failed; claiming the user tab worked. Writer QA used a separate background Browser profile. No desktop input and no installation or document creation in the real reference world.

The real tool catalogue opened the CoC Character Sheet0.1.17 live preview. Entering STR85/CON70/SIZ60 and selecting Pulp produced HP26, Build1, damage+1D4, Move8 and regular/half/fifth targets85/42/17,70/35/14,60/30/12. Modern exposed Computer Use/Electronics while retaining the edited characteristics. STR rolled72, then a pushed74 with both results retained. Ctrl+Z did not reverse the Pulp toggle in this preview; no upstream Undo success or one-push enforcement is claimed. All preview edits stayed in the preview.

Primary SDK references read: [SDK reference](https://docs.beta.vvd.world/workshop/reference/sdk), [declared search/index](https://docs.beta.vvd.world/workshop/reference/tools#search-and-the-index), command/getting-started documentation. The upstream CLI was not installed or run. Writer's documented selectors/operators are its own contract; undocumented upstream operator compatibility is not claimed.

## Native changes

- Declared portable field/reference indexes; effective Base/era queries through SDK, live hook and MCP, plus normal search of declared list/map values. The Initiative authoring example contains participant/minimum filters, document-opening results and an explicit empty result message. Selecting compiled code without an index suppresses old descriptors; explicitly saving retires them. Merely unavailable code retains the last saved portable fallback.
- Focused keyboard Undo/Redo for source documents, owned blocks and legacy source-tool views. Existing scoped state receipts remain authoritative. Native editable text retains its own Undo; Ctrl+K reaches normal global search. Async results cannot replace a newly selected client's state or unlock its operation. Owned block clients retain semantic identity through editor transactions.
- CoC paper/read-only projection appends era/Pulp, investigator conditions, daily sanity, pending checks, characteristic targets, derived/manual values, improvement marks and linked push context. Old trait rows retain their dimensions, including a valid very large manual characteristic; appended sections follow existing ink. Non-destructive recalculation/new day/development confirmations say Confirm; deletion keeps Delete.

## Browser proof

Isolated project `proj_mvkw68hg_q6tspq`, normal Manage engines and source-author reexport workflow. A temporary two-line source module exposed the existing Initiative example; it is QA-only and excluded from the commit. Created document `62841b76-a2d9-42c7-afd9-424fc7c8b8b9` through the normal collection UI; added Nora18. Filters Nora/min20 remove the result, min15 restore it. Round1→2→focusedCtrl+Z→1→Ctrl+Shift+Z→2; Ctrl+K opens global search, where Nora finds the document. Reload preserves Round2 and Nora18. The final no-match message and recovery were separately observed after reloading the last copy-only change.

Created and saved Investigadora del puerto QA through the normal CoC preset. Values85/70/60 with Pulp produce HP26. Damage13 leaves HP13/26 and a major wound/pending CON. SAN loss5 leaves45/99, daily5/10 and pending INT. Spot Hidden is marked. Save/reload retains all values. Paper contains those states, characteristic targets, derived/manual sources and the mark. New-day confirmation displays Confirm; Cancel preserves the saved state. First numeric test input appended to50; the harness then selected/replaced the fields before any comparison, rather than treating the invalid input as a product calculation defect.

Additional normal Browser flow found Codex→New Entry crashing on serialization of an already destroyed Tiptap Editor during effect reconnection. A surgical lifetime check fixes it; an actual Tiptap/StrictMode regression reproduces the same trace, while its ordinary Activity variant did not reproduce before the fix. The exact scheduler event behind the original Browser failure is not claimed. Browser then opened New Entry normally, created Nora — prueba de bloque local, edited it, inserted an owned Initiative block through References→Source blocks and performed Round1→2→Ctrl+Z→1→Ctrl+Shift+Z→2 without removing the block, then saved the parent normally.

Captures under `_stage/live-next/`: `vvd-sheet-preview.png`, `writer-index-undo.png`, `writer-index-filter.png`, `writer-index-empty.png`, `writer-confirm.png`, `writer-paper-part-a.png`, `writer-paper-part-b.png`; `writer-paper-dom.txt` contains the full SVG text after reload. Paper uses the existing nested199px scroll area at1280×720, so the complementary captures cover its state section. No mobile or whole-application visual certification.

## Independent review and regressions

Independent index review found selected-release fallback and stale descriptor-on-save defects; both were corrected, and the unchanged reviewer oracle passed. Six final groups include the author's three and the reviewer's three. Undo review reproduced late-client results/errors and swallowed global shortcuts; corrected and covered by independent lifecycle/chronology/global-command cases, plus real IndexedDB/Tiptap owned-block save tests. CoC review reproduced a22px legacy paper displacement with a large valid manual characteristic; the original trait layout was restored and the intact reviewer oracle passed. Confirmations passed two EN/ES functional groups, including cancellation and real deletion labels.

Reports: `_stage/sdk-next-index/REVIEW-independent.md`, `REVIEW-COC.md`, `_stage/live-next/undo/REVIEW-independent.md`. Retained reviewer tests are registered in the regular VVD runner. Acabado review approved only the new filters/empty state, complementary paper sections and confirmation at1280×720; it found no further material defect within that scope.

## Real MCP and limits

The actual stdio bridge exposed931tools. It created an Initiative document, applied Nora18, queried minimum20→none/minimum15→one, verified read-only behavior and exercised Undo/Redo plus rejection of a consumed receipt. It also rendered CoC into a real wiki preview after normal MCP edits and verified the stored JSON stayed identical across the read-only projection.

The hidden QA host had loaded modules before the last source fixes: real stdio does **not** certify the selected-release/save fallback corrections or the final characteristic-target table. These have final-source handler/dispatcher/React regressions and Browser proof. `_stage/live-next/mcp/RESULT.md` and its JSON retain the cached-host limitation and partial failure instead of relabelling it as a final-source pass.

Automatic approval review rejected both terminating/relaunching that QA host and launching a new hidden host with an empty profile (`blocked by policy`, no further reason). Neither rejected command ran, and neither was retried by another mechanism. It also rejected retiring the temporary source reexport; that untracked fixture remains excluded from the commit. The installed app and real profiles remain untouched. Clean-main production-build verification is required separately from any worktree build containing the QA reexport.

## Final verification and integration

`_stage/live-next/full-vvd.log`: **781groups,178suite invocations,0failures**. The normal runner now also registers the later footnote/Tiptap regressions; these were separately run as1+2groups, not included in that178 count. Those two editor fixes received a separate independent review in `_stage/live-next/percentile/review-editor-independent.md`.

Initial critical run stopped at the footnote panel-renumber wait; `_stage/live-next/critical.log` retains the failure. A deterministic real-editor regression confirmed a missed transaction between render and passive subscription in the footnote list/numbering. Subscribe-then-reconcile fixes it without changing the original test or its timeout. Complete critical rerun after that repair: **396PASS**, `_stage/live-next/critical-footnotes-final.log`. A separately isolated full footnotes-area export failed a popover-focus assertion identically with baseline and current sources; its exact focal passed in both. That isolated-context result is not presented as a regression or explained away as load.

Final renderer/Electron typechecks, shipping lint and conformance passed (`verify-quick-final.log`:34engines,64tables,6510locale keys). Worktree Vite/Electron builds passed; the Vite build contained the excluded QA author reexport and predates the last editor fixes. A clean-main build after the locked integration must validate the final production input without that fixture. Exact source commit, scoped CAS approvals and integration receipt belong to Ágora1195; no push and no task closure while parity work remains.

Submission3 review caught a later empty-message UI regression: replacing the empty results list removed its stable DOM container, so the unchanged real UI regression timed out (`formal-r3-sdk-index.log`). The correction preserves that empty list and renders the explanatory status beside it. The intact index suite passes its3groups afterward (`index-empty-final.log`), and the changed source passes ESLint. This later correction requires submission4; the earlier CoC/editor scoped votes are not automatically transferred. The781/178 run predates this message-only delta and is not misrepresented as a fresh run over it.

## Integration receipt

Exact commits `d718745faa8807f57bbcee094971e58d587dd735` and `b20315910f8ea8452eb0ec46bb006c84ac8d0d73` received new complementary CAS1095r4 approvals: `codex-writer1095-sdk-review` (index/Undo,13final groups repeated after reading r4), `codex-writer1095-coc-review` (CoC/paper/confirmations) and `codex-writer1095-editor-review` (Tiptap/footnotes). No reviewer approved its authored changes. Main was clean at freshly checked `abe57c3`; ff-only integration under `merge:Writers hoard desktop` reached exact `b203159`. No push.

Clean main, with the QA reexport absent: renderer typecheck plus production Vite build PASS (48.29s), Electron build PASS and plain-Node main manifest931tools PASS. These validate the final committed production input, separately from the earlier worktree build containing the untracked author fixture. Main tracked files/index stayed clean.

Native Google manual update used required revision/readback:198paragraphs, only Writer text changed,197other paragraph texts/styles identical. The existing Writer graph node was extended through Store with embedFalse, preserving every other node and all edges. Task1095 and its worktree remain active for further comparisons. Browser continued into the actual Table0.1.37 preview: numeric Souls sort yielded900,1750,2450,3200,8100. Card-row linkage, grouping/filter details and Writer's corresponding normal flow are the next live comparison; descriptions alone do not establish parity.
