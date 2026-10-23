# Calendar banner shapes — task1095

Source `2f21eed73c87d9c3af1e6b7f7a191f2be939b591` received independent CAS 14 approval and root reports FF integration into main. Final clean-main verification/build and the native manual update are complete, with separate receipts below. The earlier calendar/audio manual update belongs to its own receipt. Task1095 remains open.

## Observed shapes and delivered scope

Root observed the actual reference Timeline 0.1.21 in Brave: Ribbon has inward V cuts at the true ends of a multi-day band, Bunting has small lower triangular teeth, and Scallop has small lower semicircular waves. The captures in `_stage/calendar-next/` were inspected by the author and independent reviewer. This records a functional visual comparison with Writer's own geometry, without promising pixel identity or reusing reference styles/assets.

Optional `bannerShape` accepts `plain`, `ribbon`, `bunting` and `scallop`, separately from the existing solid/stripes/dots/checks `bannerPattern`. The labelled shape selector is shared by the existing list, swimlane and Calendar-connected editor. Missing shape retains the prior Plain style without migration or write-on-read. Switching to Plain removes decoration while preserving fill, title, dates and repeat settings.

Calendar bands keep their day-to-day continuity. Ribbon cuts only true endpoints; week/month truncation does not create a false endpoint. Decorative titles appear at the start of an occurrence and at the first visible week/month fragment; central fragments retain accessible text. Plain preserves its earlier repeated-title/style behavior. The existing three-visible-bands plus additional-count limit is unchanged. Year view remains points, and wiki output remains its event list rather than a decorated calendar.

Existing native create/update schemas and handlers validate the additive enum, and `wh_list_events` reads Plain when the field is missing without modifying its row. Existing Undo records optional absence and uses the normal executor's era receipt. Form, fill, date and recurrence remain separate. JSON clone and ZIP preserve complete rows and were tested without introducing another format or changing persistence code. No new tool, table or event CAS contract is claimed.

## Author and independent evidence

The author froze ten paths: eight production sources, one focused guide and one test. Six focused groups passed through the real schema executor/dispatcher/DB, field component, CalendarView, shared editor, era and Undo/portability path. Sixteen legacy groups were recorded separately. `_stage/calendar-shapes-next/RESULT.md`, `paths.txt` and `hashes.txt` preserve their attribution. Author types and eight-source lint passed; this documentation pass did not run those checks.

The independent reviewer executed sixteen groups on the frozen source: six author groups repeated, three independent oracles and seven legacy groups. Ten hashes matched before/after. Own oracles covered invalid mixed patches without writes, storage failure/retry and normal Undo, deleted events, a five-day-week/two-day-offset calendar across short months, world-date era changes, optional absence and real clone/ZIP. These counts overlap the author's and other suites; they are not added into a new global total. DOM checks compute inline masks, clip paths and fills, while full-render evidence comes from root's normal Browser. See `_stage/calendar-shapes-next/review-independent.md`.

Original product REDs remain: ignored create/update shape and missing selector. Test mistakes involving nonexistent `wh_get_timeline`, raw dispatcher audit versus the real executor, failure-audit expectations and optional undefined properties are retained separately. They are not relabelled as product regressions or hidden by final PASS logs. Ribbon remains invalid as a fill pattern; it is a shape.

## Root's normal Brave check

After deliberate reload with HMR off in synthetic QA project `proj_mvl51nyx_tl1a8w`, root saved Ribbon+Stripes, Bunting+Dots and Scallop+Checks on the existing Jan 10–12 1500 weekly event. Reopening confirmed both independent selectors. Plain retained Checks and restored earlier titles on days 10/11/12; Scallop+Checks was saved again as the final state. Separate normal captures are `writer-ribbon-normal.png`, `writer-bunting-normal.png` and `writer-scallop-normal.png`.

Root also created a named single-day band on Jan 14, then extended it through Jan 16 using the already-established native date-input interaction. The single day showed both Ribbon cuts; crossing the week restarted the title on Jan 15 and kept the true endpoint on Jan 16. The weekly occurrence spanning Jan 31–Feb 2 continued into February with a title on the first visible fragment and no false starting cut on Feb 1. Captures `writer-single-normal.png`, `writer-week-boundary.png` and `writer-month-boundary.png` and `_stage/calendar-shapes-next/REFERENCE-root.md` retain this evidence. This documentation pass inspected the month-boundary image but did not operate Browser or infer the complete sequence from one frame.

## Formal approval and completion receipts

`_stage/calendar-shapes-next/review-formal-task-before.json`, `review-formal-hashes.json`, `review-formal-vote.txt` and `review-formal-receipt.json` record the new submission read before the CAS 14 vote and approval of exact source `2f21eed73c87d9c3af1e6b7f7a191f2be939b591`. Root reports FF integration. The peer's immutable groups were not rerun solely for commit/registration.

Root's `_stage/calendar-shapes-next/main-verify.log` records successful renderer/Electron typechecks, zero shipping-lint fingerprints and conformance: 34 engines, 64 tables, 6515 locale keys, 22 locale files and zero known warnings. `main-build.log` records Vite 27.77s, Electron bundles and both plain-Node manifest/schema checks with 934 tools. Root session 36816 ended exit 0; root confirmed main at the exact source with clean status and released the merge lock. These are root's final build/catalogue receipts, not 934 end-to-end tools or a new global suite. This documentation pass only read them.

Root also acquired and released the required locks for the native manual update. `_stage/calendar-shapes-next/manual-receipt.json` records this exact shape source, 314 added characters, 198 paragraphs, 197 other paragraphs unchanged, all paragraph styles preserved and the new document revision after CAS/readback. Its description covers four shapes with independent fills, persistence/Undo/copy, week/month continuity and the wiki-list/year-points limits. The separate earlier calendar/audio receipt is complete but is not substituted for this shape receipt. This pass did not edit the manual.

No new stdio transport, installed-profile update, decorated wiki/year view, image/saved-banner workflow, full-reference parity or task closure is claimed. C-writing row 83 retains PARTIAL coverage of its broader claim; historical wave counts stay historical.
