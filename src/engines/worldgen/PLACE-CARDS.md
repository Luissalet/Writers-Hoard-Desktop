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


## Being there and dated weather

The Place panel also reads the ground at any point. Click empty ground in 2D,
Carta or 3D, or choose Place and cards in the atlas Index. With the Place panel
active, a map click inspects that point. Ordinary town, waypoint, region and
editing gestures retain their existing actions outside that panel.

Choose Date in the world in the Place or Travel panel. This uses the project's
calendar (including an inherited saga calendar). Only an exact valid day has
weather; a year, a month or an approximate date never invents a daily sky.
The reference shows relief, the biome's vegetation, inferred substrate, local
building materials and possible food sources. Spoken language and its ancestry
come from the existing realm/culture language tree. The nearest market and its
production/price indices use the existing economy and authored sites, with a
150 km local radius, also used for nearby settlements and ruins. Unknown culture
or an absent market is shown explicitly. These are derived references and do
not rewrite Codex cards or establish authored cultural facts.

`wh_get_world_weather {worldId,key?,x?,y?,date:{year,month,day}}` reads daily
conditions and sky; give an atlas key or a cell point. `wh_describe_world_presence`
uses the same arguments with optional date. Both are read-only and use the same
pending-generation, project and era boundaries as existing place tools.

The weather model is `world-weather/1`. It reads the annual climate (already
adjusted for height and ocean currents) and deterministic, spatially coherent
weather fronts. It uses the calendar's actual year length, leap rules and local
day length; the first day is the northern spring equinox and axial tilt is fixed
at 23.44 degrees. Sunrise/sunset are local solar hours, with explicit polar-day
and polar-night states. Each moon is computed by the existing calendar function.
Night light is a relative lunar illumination index attenuated by clouds, not lux
or a claim that all moons are above the horizon.

Travel's dated-weather option starts disabled. It keeps the selected path and
spends each edge across moving days, sampling that date's conditions as the
party advances, with hard-pace rest days included. Delays update duration,
stretches and overnight stages together. It is not a dynamic route search for
the weather-optimal path. Saved journeys retain the calendar/date snapshot.
Creative journey captures retain sampled weather beside their existing origin
receipt, and the generated note/scene text remains editable before saving.

`ChapterWorldContext` is the read-only manuscript/reference component. It
resolves the chapter's world date and its explicit atlas links, including scenes
connected through outline beats. Multiple places remain separate; prose is not
used to guess a location. A partial date still permits the place reference.
