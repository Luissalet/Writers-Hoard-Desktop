# VVD parity: timeline details and reusable calendars

Later completion: `vvd-timeline-scopes.md` implements and verifies the originally deferred per-timeline calendars, explicit range/precision and zero-based/cyclical-era controls. The remaining-gap notes below record the first delivery, not the final state.

- [x] Read current timeline/calendar math, inheritance, event forms and official VVD timeline documentation (updated 2026-08-20; read 2026-10-20).
- [x] Add multiple linked Codex cards, local event image and icon in both event forms and read views.
- [x] Add validated start/end clock times, configurable world hours/day and chronological positioning without changing legacy day arithmetic.
- [x] Add reusable local named calendar presets plus explicit generic/Earth-style starting points.
- [x] Update narrow link cleanup/import/read consumers and verify second-link deletion and import re-ID.
- [x] Run existing calendar/date suites and focused new UI/security/math tests.

Source: https://vvd.crisp.help/en/article/timelines-1ky9csp/ . Scope preserves the existing project/saga inherited world calendar. Per-timeline independent calendars are deliberately deferred because multiple unrelated calendar axes require explicit correspondence rather than silently mixing dates.

Verification: focused timeline-rich browser suite passes 7 groups, including actual list/swim forms, keyboard editing, direct selected-event card navigation, local image upload, inherited 30-hour clock ranges, calendar preset UI save/delete/load, JSON re-ID and primary/secondary link cleanup, evidence/export, MCP field creation/update/foreign-link refusal. Existing world-calendar logic9 groups, calendar UI5 groups, dated-writing5 groups, family exchange8 groups and world-bible4 groups pass. Conformance passes30 engines/5528 locale keys. Focused ESLint clean. Desktop/narrow screenshots with current compiled CSS inspected; one overlap between a range icon and title was corrected and confirmed in second pass. Screenshots: C:\Users\luism\AppData\Local\Temp\wh-timeline-rich-wM2h50\timeline-desktop.png and timeline-narrow.png.

Remaining documented parity gaps: independent calendars per timeline (requires correspondence for mixed axes), explicit visible year limits and date precision controls, and a zero-based/cyclical-era settings flow. Existing era definitions, ranged events, manual reordering, connections, zoom, moons, holidays and project/saga calendar inheritance remain available. ProjectIntelligence contains no timeline-link consumer to migrate.
