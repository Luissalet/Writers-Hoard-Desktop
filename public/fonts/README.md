# Optional bundled fonts

Writers Hoard is local-first. Its current typography uses the deliberate
system stacks declared in `src/index.css`; it makes no font request and does
not depend on a network connection.

If custom faces are bundled later, add each `.woff2` asset and its original
SIL Open Font License text here before adding the matching `@font-face` rule.
Never declare a missing public asset: Vite's development fallback can return
the app shell for that URL, which Chromium correctly rejects as an invalid
font.

The intended optional families are Cinzel for display text, Source Sans 3 for
interface text and JetBrains Mono for technical text. Include only weights the
interface actually uses and verify both the development and packaged desktop
builds after adding them.
