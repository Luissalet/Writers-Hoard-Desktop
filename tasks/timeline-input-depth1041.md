# L09 native timeline input

The inventory locates scroll/zoom but has no exact wheel test. Exercise the
normal populated SwimLane canvas at1440/640: ordinary horizontal wheel scroll,
Ctrl+wheel canvas zoom, prevention of browser scroll/zoom for that handled event,
and keyboard-accessible zoom buttons. Preserve event/timeline rows. A read-only
wheel observer may inspect defaultPrevented; it must not cancel the event itself.
Keep any original failure before a narrow handler repair; do not add zoom to
list/calendar views without a relevant canvas contract.

## Result21 October

The normal Electron wheel modifier alone produced no DOM event; those original
QA failures remain. A diagnostic-only wrapper sends physical Control keydown and
keyup around the same wheel and leaves the original oracle intact. That route
reproduced a real product failure: canvas zoom changed, React's passive warning
appeared and defaultPrevented stayed false. The single component correction
installs an effect-owned native wheel listener with passive:false, handling only
Ctrl/Meta and removing the same listener on cleanup.

The unchanged oracle now passes1440/640 native horizontal scroll, Ctrl cancellation,
unchanged browser scale, Enter zoom and exact24 authored rows. Independent review
repeats those two groups plus two new ordinary/Shift/Meta/StrictMode lifetime groups,
with no product/oracle/wrapper edits and no passive warning. Normal wheel stays
uncancelled. Root and reviewer inspected the two screenshots separately.

Review: work/timeline-wheel-independent/review.md (SHA de557067…e641e), separate
provenance0e7b7fe4…6ff3f. This is a scoped SHIP for L09, not general timeline parity.
