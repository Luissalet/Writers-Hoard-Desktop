# Portable figure contract

`parsePortableFigure` reads the complete `vitruvius.figure/1` capture without storage, editor, network or module activation. It retains original supplied JSON text, a separate complete object, exact PNG bytes and dimensions. Unknown optional JSON fields and absent/null selections survive. Origin links remain inert metadata. `figureFingerprint` hashes the entire capture with sorted object keys, including source, preview, revision and page/state selection.

PNG validation here covers its signature and IHDR dimensions. It does **not** certify IDAT/pixel decoding; the insertion flow must decode the image successfully before writing a manuscript or asset. No image is transcoded by this parser.

Run the independent contract fixtures without installing dependencies:

```sh
node --experimental-strip-types --test src/services/figureInterchange/figure.test.mjs
```

This is the first part of task1060, prepared alongside the active1041 integration. It is not yet wired into the editor or API/MCP and does not insert/export figures. Integration must use the existing shared tool manifest/dispatch, Tiptap schemas/projections, normal revisions and undo, with HTML/PDF and DOCX image export verified separately. At the inspected Main baseline, publishing DOCX/ePub deliberately omit images; accepting this contract does not change that policy. No shared database/editor/tool/dependency files are changed by this part.
