# Portable figure contract

`parsePortableFigure` reads the complete `vitruvius.figure/1` capture without storage, editor, network or module activation. It retains original supplied JSON text, a separate complete object, exact PNG bytes and dimensions. Unknown optional JSON fields and absent/null selections survive. Origin links remain inert metadata. `figureFingerprint` hashes the entire capture with sorted object keys, including source, preview, revision and page/state selection.

The pure parser checks the PNG signature and IHDR dimensions; its `signature-and-dimensions` marker does **not** certify pixel decoding. In the browser renderer, call `decodeFigurePreview` from `preview.ts` before writing a manuscript or asset. It decodes through the browser's native image decoder, checks decoded dimensions, closes the bitmap on success or failure, and returns a separate `DecodedFigure` with `pngValidation: 'decoded-pixels'`. Corrupt PNGs fail before any future persistence. The complete source and original PNG bytes remain unchanged; neither stage transcodes the capture, fetches origins or writes data. A renderer without image decoding returns an explicit error.

Run the independent contract fixtures without installing dependencies:

```sh
node --experimental-strip-types --test src/services/figureInterchange/figure.test.mjs
```

This is the first part of task1060, prepared alongside the active1041 integration. It is not yet wired into the editor or API/MCP and does not insert/export figures. Integration must use the existing shared tool manifest/dispatch, Tiptap schemas/projections, normal revisions and undo, with HTML/PDF and DOCX image export verified separately. At the inspected Main baseline, publishing DOCX/ePub deliberately omit images; accepting this contract does not change that policy. No shared database/editor/tool/dependency files are changed by this part.
