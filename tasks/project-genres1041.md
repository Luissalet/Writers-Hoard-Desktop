# Project genres —1041

Observed authenticated World Info includes name, description and multiple genres.
Writer's main Project lacks genres; FictionWorld is a different document.
Add optional portable Project.genres, a shared compact picker for create/edit,
and normal scoped get/set tools. Presets are suggestions; custom labels remain
valid. Existing projects need no migration. Absence in old backups preserves
existing genres; explicit [] clears. Do not change engine presets or prose.

Success: create/edit keeps multiple and custom Unicode genres; normal MCP set
is field-CAS and leaves unrelated metadata intact; JSON/full/ZIP/clone preserve
them; invalid imported metadata rejects before writes. Native normal form and
external tool route, plus appropriate checks. No UI superiority/global parity
claim follows from adding this field.
