# XLSX column widths

Revision 3 of task 2316 preserves explicit positive widths on workbook import
and export through the normal table view and the existing `wh_table_import_xlsx`,
`wh_table_get` and `wh_table_export_xlsx` tools. It includes column ranges, empty
columns with widths, and worksheets without cells. Missing widths remain absent
in the exported file. Renaming or changing another column property preserves an
imported width outside the editor's usual range.

Conversion follows the documented OOXML formula with a maximum digit width of
7 pixels, the Calibri 11 basis at 96 dpi. Writer does not import workbook fonts.
Widths and their rounding therefore follow that basis rather than promising
identical typography with every font. Other formatting and merged cells remain
outside this increment. Primary references are Microsoft's [Column documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column?view=openxml-3.0.1)
and [MS-OI29500](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/727f4736-6cba-40e3-b4d3-ce319885780e).

## Verification

An independent real Brave check imported a synthetic workbook with two tabs,
five populated cells and widths of 61, 1200 and 168 pixels. The empty third
column retained its width. Revision 1 widened the narrow column to 86.46 pixels
because its header controls needed more space. Stacking them fixed the short
name, but revision 2 still grew to 84.31 pixels after renaming. Revision 3 allows
the full accessible name to truncate visually and retains sorting and column
options. It measured 60.99, 1200 and 167.99 pixels with a long unbroken name and
after reopening. The second tab retained its content and default width. These
measurements establish the checked fixture and view, not universal layout
precision.

The normal Excel button emitted a ZIP with both tabs and the same five cells.
Its three column records convert back to 61, 1200 and 168 pixels; the second tab
omits `cols`. The download observer timed out and no physical downloaded file
was established. The emitted Blob was inspected using a one-shot CDP observer
around `URL.createObjectURL`, restored and removed afterward. Blob verification
is distinct from verification of a completed download.

The independent TableTools suite passed 31 checks and final `verify:quick`
passed renderer/electron types, shipping lint and conformance. Width checks cover
import, ranges, invalid metadata, export, UI edits and the table bridge runner.
They are not a fresh stdio transport check with two keys. Local receipts are in
`E:/Development/IA/Research/writer-parity-20261109/xlsx-width`, including
`writer-brave-r3.json`, `writer-ui-export-receipt.json`, `ROOT-APPROVE-r3.md` and
`INTEGRATION.json`.

Source commits b433c06f, c1f2ac33 and 8ee3d4b1 were integrated as db629a7e without
push. All five approved blobs and 4687 unrelated paths were checked afterward.
Historical claims about the reference application's XLSX fidelity came from UI
strings, not a completed import oracle. Its current beta and production catalogs
did not expose Sheet in the inspected search. This increment has its own
exchange proof and does not establish overall parity.
