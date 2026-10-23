# Offline wiki appearance and navigation

Named wiki profiles save independent source policies and appearances. The earlier
four themes, serif/sans selection and side/upper index layouts remain available.
Optional overrides add separate heading/body fonts and five colours: background,
accent, secondary surface, text and border. Fonts use installed system families
and local fallbacks; no web-font download is required. Copying a saved profile's
appearance copies only palette and typography, preserving the current source era,
sections, excluded fields and documents.

A profile can also include a literal publication name/footer and a local raster
mark. Excluding images physically removes that mark and the other omitted images
from the exported HTML. Text is escaped, fonts come from a fixed local-family list,
and custom colours accept six-digit hexadecimal values.

Terminal adds boxed reading typography. Command navigation keeps the ordinary
index and search and adds a keyboard form. Commands are `help`, `list`,
`search text`, `open name`, `home` and `clear`; Spanish equivalents are accepted.
Unrecognised input searches as text. Opening an exact admitted name or alias
navigates to that document; ambiguous names produce choices. Arrow keys recall
commands from the current session. This is document navigation, with no operating
system shell or generated answers.

Profiles, JSON/ZIP backups, clones and immutable local wiki editions preserve
these options. The exported file contains its admitted content and runs without
Writer, its database, bridge or network. Profile MCP operations and
`wh_wiki_export` accept the same appearance options. Named profiles can restore an
earlier edition's configuration without replacing original documents or siblings.

## Palettes, saved palettes, footer and terminal extras

**Palette catalogue.** The appearance editor offers 20 named palettes in four
groups (light, dark, book/serif-friendly, high contrast; `src/services/wikiProfiles/palettes.ts`).
A palette only fills the five existing colour tokens, so it is exactly the same
data as hand-picked colours; every catalogue palette has text on background of at
least 7:1 and accent on background of at least 4.5:1 (checked by the test).
"Back to the theme" removes the overrides.

**Saved palettes.** "Save my palette" stores the five current colours under a
name (up to 40 characters, unique ignoring case, at most 24 per profile). They
can be applied, renamed and deleted. They are kept in `options.customPalettes`
of the profile (or of the legacy preferences), not in app settings: the options
already travel in profiles, project/full JSON, ZIP and clones, so no new backup
registration is needed and a palette follows the world it was made for. The
export never reads them. Colours are validated like the existing five (six-digit
hex); a palette needs all five. Like every other option they are persisted by
"Save preferences". "Copy appearance from a profile" copies them too.

**Footer.** `branding.links` takes up to six `{label, url}` pairs and
`branding.signature` one line of text. Only `http:`, `https:` and `mailto:`
addresses are accepted (no `javascript:`, `data:`, `file:`, credentials in the
address, quotes, spaces or control characters). Links are written escaped with
`target="_blank" rel="noopener noreferrer"`. The export's Content-Security-Policy
is unchanged (no network is fetched; links are only followed when clicked). A
profile with only the old footer text exports the same footer bytes as before.

**Terminal extras** (`options.terminal`, Terminal and Shell layouts only, ignored
elsewhere): `phosphor` (amber, green, ice, purple, red; replaces the theme and
custom colours while chosen), `scanlines` (CRT lines and a soft glow, hidden when
printing), `dither` (a small script in the exported page turns embedded pictures
into two-colour ordered dithers using the page's own colours; it runs offline and
falls back to the plain picture if the browser cannot decode it), `bootLine` (one
line shown above the title, blinking cursor stopped under reduced-motion) and
`opening` (up to eight `{command, note?}` buttons under "New here?" that run the
command in the Shell command line; Terminal has no command line, so it ignores
the list). Everything is off by default; a profile without `terminal`, `customPalettes`
or `branding.links` exports the same bytes as before these features.

**Changes since the last edition.** In the export panel, once a profile has an
edition and the section is opened, "Changes since the last edition" lists added,
changed and removed documents and the publish button reads "Publish (N changes)".
It is computed on open, after saving or publishing and on "Check changes", never
while typing or editing a card. The check compares the captured-source
fingerprint and the saved configuration with the last edition's; only when they
differ does it render the wiki once and compare each document's article with the
frozen one, so it counts what a reader would see (edits to excluded cards or
fields do not count). If the app's rendering changed between versions, a world
that was also edited may list documents whose text did not change; the count
returns to zero after the next publish. `wh_wiki_profile_changes` (read-only)
returns `{changes:[{documentId,title,kind,change}],count,lastEditionAt}` plus
`configChanged`, `sourceChanged` and `editionId`.

**Maps in the exported wiki (wave D2).** Four optional profile settings, all off by
default (a profile that sets none exports the same bytes as before):

- `mapNavigation` (`free` or `contained`): the map block gets pan and zoom. Drag with
  the mouse or one finger, pinch with two, Ctrl/Cmd + wheel (or the plain wheel
  while the map has keyboard focus) to zoom, arrows to move, `+`/`-` to zoom and `0`
  to reset, plus on-screen zoom and reset buttons. `contained` keeps the picture
  covering the frame (it cannot be dragged past an edge or zoomed out); `free` lets
  it leave the frame (zoom 0.5 to 8). Pins and their numbers keep their size. A
  plain wheel over an unfocused map scrolls the page, on purpose.
- `mapArtwork`: draws the map's illustration layers, set in the map editor under
  "Capas de ilustración" or with `wh_map_artwork`: a background (behind and around
  the picture, visible when the map is panned or the picture is transparent), a
  middle layer (over the picture, under the pins) and a foreground. They drift at
  different depths while the reader pans and stay still when the reader prefers
  reduced motion. Layers are raster data URLs (no SVG, no remote address); one layer
  may be up to 8 million characters and the three together 16 million, otherwise
  that layer is left out of the page.
- `mapClouds`: a drifting CSS cloud overlay (also switched on per map by the map's
  own cloud setting when `mapArtwork` is on); the reader can hide it with the
  "Nubes" button, and it stands still under reduced motion.
- `mapAmbience`: a map can loop a local audio asset and each pin can have its own
  loop with a volume and a radius (percent of the map width). Nothing plays until
  the reader presses the map's sound button; then the map loop plays and a pin loop
  fades in as the centre of the view approaches the pin. Tracks are embedded once
  each (12 MB per track, 24 MB in total) and need "Include linked audio and video".
  Turning the sound button off pauses everything.

The page keeps its content security policy: scripts carry the nonce, images and
audio are `data:` URLs, nothing is fetched. Artwork and ambience belong to the map
and pin rows, so JSON/ZIP backups and project copies keep them (a copy points
the ambience at its own copy of the audio). Set the profile options in the export
panel under "Mapas de la wiki" or with `wh_wiki_profile_save`.
