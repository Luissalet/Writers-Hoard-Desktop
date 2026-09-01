# Bundled fonts

The app's chrome (titles, labels, buttons, code) is set in three families. They
used to be fetched from `fonts.googleapis.com` at runtime, which made a
local-first app depend on the network to look like itself. `src/index.css` now
declares them as `@font-face` rules pointing here.

**These ten files are not in the repo yet — drop them in and the chrome is
typeset. Until then the app falls back to the system stacks named in
`@theme`, which is what happens offline today anyway.** Nothing breaks, in dev
or in the packaged build; Vite leaves an unresolved `url()` alone and warns.

## Files to add

Exact names — `src/index.css` asks for these and nothing else.

| File | Family | Weight | Style |
| --- | --- | --- | --- |
| `cinzel-400.woff2` | Cinzel | 400 | normal |
| `cinzel-600.woff2` | Cinzel | 600 | normal |
| `cinzel-700.woff2` | Cinzel | 700 | normal |
| `source-sans-3-400.woff2` | Source Sans 3 | 400 | normal |
| `source-sans-3-400-italic.woff2` | Source Sans 3 | 400 | italic |
| `source-sans-3-500.woff2` | Source Sans 3 | 500 | normal |
| `source-sans-3-600.woff2` | Source Sans 3 | 600 | normal |
| `source-sans-3-700.woff2` | Source Sans 3 | 700 | normal |
| `jetbrains-mono-400.woff2` | JetBrains Mono | 400 | normal |
| `jetbrains-mono-500.woff2` | JetBrains Mono | 500 | normal |

**Format: `woff2` only.** The renderer is always Chromium (Electron), so a
`woff`/`ttf` fallback would be dead weight shipped to every user.

**Subset: latin + latin-ext, as ONE file per weight.** Google's own CSS splits
each face into a dozen unicode-range slices; that split is a bandwidth
optimisation for websites and pure overhead here, where the files are read off
local disk. `google-webfonts-helper` (or `pyftsubset`) produces exactly the
per-weight files named above.

Why these weights and no others: the UI uses `font-medium` (500),
`font-semibold` (600) and `font-bold` (700) plus the 400 default; `font-light`
appears nowhere, so the 300 the old `@import` fetched was never drawn. Cinzel
is only ever asked for at 400/600/700, and it has no italic — a `font-serif
italic` in the notes engine is synthesised, as it was before. If a weight is
missing at runtime the browser synthesises it from a neighbour; nothing errors.

## Licences

All three are **SIL Open Font License 1.1**, which permits bundling and
redistribution inside an application:

| Family | Author | Licence |
| --- | --- | --- |
| Cinzel | Natanael Gama | OFL 1.1 |
| Source Sans 3 | Adobe | OFL 1.1 |
| JetBrains Mono | JetBrains | OFL 1.1 |

The OFL requires the licence text to travel with the fonts, so drop each
family's `OFL.txt` in beside the `.woff2` files (`cinzel-OFL.txt`,
`source-sans-3-OFL.txt`, `jetbrains-mono-OFL.txt`) — everything in `public/` is
copied verbatim into `dist/`, so they ship with the app and satisfy that on
their own. Check each family's own licence file for a Reserved Font Name clause
before renaming anything beyond these filenames; renaming the *files* is fine,
renaming the *font* is what the clause is about.

## How the path resolves

`src/index.css` references these as `/fonts/<name>.woff2` — slash-rooted, which
is how Vite recognises a public-directory asset. The file is copied to
`dist/fonts/`, and because the desktop build runs with `VITE_BASE_URL=./`
(`npm run build:desktop`), Vite rewrites the reference in the emitted stylesheet
to a path relative to that stylesheet, `../fonts/<name>.woff2`. That is what the
packaged app needs: `electron/main.ts` opens the renderer with
`loadFile(dist/index.html)`, so the origin is `file://` and an absolute
`/fonts/…` would be read from the root of the user's disk. A hand-written
`../fonts/…` would fail the other way — Vite resolves relative css urls against
`src/`, where these files do not live. In `npm run dev` the same slash-rooted
URL is served straight from `public/`.

`index.html`'s Content-Security-Policy no longer allows `fonts.googleapis.com`
or `fonts.gstatic.com`: `style-src 'self' 'unsafe-inline'; font-src 'self'
data:`. A font added back over the network would now be blocked rather than
silently make the app online-only again.
