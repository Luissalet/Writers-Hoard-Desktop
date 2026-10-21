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
