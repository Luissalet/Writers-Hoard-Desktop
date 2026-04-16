# Lessons Learned

## 1. Always run `npx tsc -b --noEmit` before declaring work complete
**Date:** 2026-04-16
**Context:** Delivered code changes without checking TypeScript compilation. User caught two TS errors.
**Rule:** After any code change in this project, run TypeScript type-checking and fix all errors before telling the user it's done. No exceptions.

## 2. Don't use useAutoSelect on engines with list→detail navigation
**Date:** 2026-04-17
**Context:** Dialog engine used `useAutoSelect` which immediately re-selected a scene after pressing Back, trapping the user in the editor. The scene list view was unreachable.
**Rule:** `useAutoSelect` is for engines where something should always be selected (Codex, Diary). Engines with explicit list→editor flows (Dialog/Scene, Video Planner) must NOT use it — the empty state IS the list view.
