# Editing calendar events

Select a day in Timeline's Calendar view, then select an event's title to open
its existing event editor. The owning timeline supplies the row and the current
pane supplies its era. The calendar remains mounted while the editor is open:
Save or Cancel returns to the same month and selected day. Closing the editor
returns keyboard focus to the event's button while it remains in the same pane.
A failed save retains
the editor and its draft for retry. The quick-add title field still creates a
one-day point; the full editor provides end dates and repeat options.

Gregorian start/end date inputs have accessible labels. Existing event data,
range calculation, recurrence and band patterns are unchanged. Native MCP
`wh_create_event`, `wh_update_event` and `wh_list_events` already expose these
fields; this UI entry uses the same operations rather than adding another
editing model. Calendar views mounted without an open-event callback retain
read-only event details.

Writer supports weekly/monthly/yearly repeats and solid/stripes/dots/checks
patterns. Decorative banner shapes such as ribbon are not represented by those
patterns. No format migration or automatic date conversion is performed by
opening an event.
