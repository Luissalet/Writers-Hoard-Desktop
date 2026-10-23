# Atlas places and Codex cards

In the atlas Index, search and select a place, then choose **Place and cards** to
open its existing Place inspector without moving the camera. The map's ordinary
settlement click retains its current navigation behaviour. The inspector can
link any Codex type as well as the existing scenes, writings and timeline events.
**Create card** makes a normal Codex card with the confirmed place name and the
chosen type, and saves its existing manuscript link in the same transaction.
**Open card** follows the ordinary pane route and retains its era. It does not
synchronize later renames automatically. An unavailable place or a failed write
keeps an error and permits retry; it never reports a partial creation as success.

MCP adds `wh_create_place_card {worldId,key,type?}` beside the existing
`wh_link_place` and `wh_list_place_links`. Source resolution uses the actual
atlas and the normal pending-generation response. Shared base and named eras use
the same operations as the inspector. Undo checks the created card, its link and
later project references together; it refuses to erase later work. Historical
versions remain recoverable. Project JSON now includes `entityLinks` when present
and remaps both ends through the existing imported ID map, including spatial
`world::key` identities; JSON without links keeps its prior shape. ZIP uses its
existing project-tools/worldgen strategies.
