# Independent timeline calendars and year views

Official evidence: VVD Timelines help, updated 20 August 2026, read 20 October 2026: https://vvd.crisp.help/en/article/timelines-1ky9csp/. Describes one calendar per timeline, custom year ranges, negative years, cyclical eras restarting at zero, and date precision through hours.

- [x] Add optional per-timeline calendar/range/precision without new schema; preserve project and saga fallback.
- [x] Share scope resolution across forms, clocks, swim lanes, MCP and portable world exports; manuscript remains in project calendar.
- [x] Reuse calendar settings/presets with explicit independent-calendar choice and atomic existing-date validation.
- [x] Add zero-based era years, durations shifting following eras, optional first-era date domain; preserve absolute date arithmetic and legacy one-based eras.
- [x] Keep range filtering reversible and show boundary labels; date precision only changes compact display.
- [x] Verify dedicated actual UI, inheritance, independent clocks, invalid changes rollback, era boundaries, deep links, exports and ZIP.

Calendar alignment uses the existing absolute day-zero convention. Independent timelines use their own day lengths and month definitions to map dates to that day axis; the shared view explains this. The final era is open-ended. No conversion or destructive rewriting of stored absolute world dates occurs.

Verification: dedicated scope suite6 groups, legacy pure calendar9, rich timeline7, calendar UI5, world Bible4 and family exchange pass. Focused ESLint clean. Conformance only reports another agent's character-sheets static definition. Current-CSS screenshots inspected at1280 and720; no horizontal overflow, removed nested modal scrolling. Latest screenshots: C:\Users\luism\AppData\Local\Temp\wh-timeline-scope-h1LDmW\scopes-desktop.png and scopes-narrow.png. Existing chapter date regression running during handoff.

