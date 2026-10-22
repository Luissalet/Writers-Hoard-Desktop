# Local world authoring

Writer stores project documents locally. Its ordinary UI and MCP tools use the
same scoped operations. A named era overlays Shared base; editing that era does
not silently rewrite the base document. Different panes retain their own scope.

## Projects and Library

Pin a project to keep it ahead of recent projects. Genres accept suggested and
custom labels. Library organizes references to the original documents in nested
folders; moving a reference keeps the original in its engine. Select a folder
and choose **New card** to open the normal Codex form with that destination.
Templates, fields and content work as in Codex. Card creation and placement save
together. A stale or removed destination retains the form for review and retry.

MCP clients read folders and their revision with `wh_workspace_library_get`, then
pass `folderId` and `expectedLibraryRevision` to `wh_create_codex_entry`. An empty
folder ID means Unfiled. Calls without those options retain normal creation.

**Duplicate project** prepares a complete local copy of one project, including
owned documents, metadata, eras, retained history, archived documents and managed
Scrapper files. Typed internal references receive the copied identities; ordinary
prose and opaque tool payloads remain literal. Personal-library originals, tags
and native publishing objects stay shared through new project references. A
copied book is a sibling in its saga; a copied saga does not recursively duplicate
its child projects. Generated map caches are regenerated from the saved world.

An interrupted native completion reports the created project and resumes the
same copy when retried. Reopening the dialog discovers pending completion. Undo
removes a pristine copy and its newly owned resources; later author edits are
retained. The original project and shared originals are preserved.

## Codex and connected documents

Reusable types support inheritance, icons, colors, portrait/landscape/hidden
images, and visibility in pickers. Existing cards can change type while retaining
authored fields and references. Add a property directly to a card; typed fields,
reference fields, option lists, option colors and calculations remain available.
Crop or rotate an image while retaining its original for another edit.

Names and aliases resolve existing references. Optional local entity detection
suggests new cards; it is separate from linking known cards. The local classifier
and image/text visual search use explicitly prepared cached models. Preparing a
model initially needs a download; an empty cache is not an offline-ready model.
Text generation uses the configured global Sparks runtime, not a hidden text
model fallback on the PC.

Codex, maps, boards, relation trees and timelines have focused editors that keep
their real document identity and era. Dirty tool drafts must be saved in their
own editor before returning to preview. Embedded references, media and models
also have offline reading/export projections; a static PNG does not replace an
interactive editor, video player or3D camera.

## Manuscript and tools beside it

The ordinary manuscript retains its formatting, annotations, replies, footnotes,
Judge/reference utilities, drafts and version history. A separate tool dock can
hold document references, independently owned source blocks and world-scoped
blocks. Reorder blocks, change their height and switch supported document views
between preview and editing. Existing Reference/Footnote/Judge tabs remain.

A project default serves Book and chapters that inherit it. A chapter can
customize its own dock, or reset to the current default; a named era can define
its contextual default. An explicitly empty layout differs from inheritance.
Undo/Redo and recovery use scoped versions. Restoring an older layout renews its
generation so an obsolete editor cannot resume writing to a restored identity.
Dock metadata is an authoring sidecar; it is not silently inserted into Reader
or wiki prose.

Local source tools have documents, typed state codecs, declared references,
owned/world blocks, retained releases, Undo and local authoring helpers. Archives
preserve source data and release metadata; they do not embed arbitrary compiled
JavaScript. See [local tool SDK](local-tool-sdk.md) for installation and development.
The runtime has its own API and storage model; binary compatibility with another
SDK, arbitrary app hosts and network collaboration are not claimed.

## Maps, trees, tables and media

Generated maps retain one geography across illustrated parchment, engraving,
painted relief and survey looks. Terrain, coastline, rivers, named places, paths,
zones, layers, time versions, journeys and3D views remain editable locally.
Imported map images support the document's own overlays. Map exports use the
same cartographic materials; generated3D terrain is actual geometry.
On a classic (image) map, each region, route or label can have its own outline
colour and width, a hatch over a region's fill (horizontal, vertical or
diagonal stripes, dots, crosshatch, with a scale), and lettering (font, size,
colour, halo and its width, bold, italic, rotation); shapes move to the front
or back of the drawing order, a vertex is added by pulling the handle halfway
along an edge and removed with a double-click, and a shape or pin can belong to
several named layers (shown while any of them that still exists is visible).
Pins come in three sizes and can hide their icon. The SVG export draws all of it.
The Codex link of a shape or pin is a search box (accent-free, by words) that
can also create a new entry of a chosen type. Right-clicking the map offers,
at that spot: a new entry (and a pin linked to it), a pin, a region or route
that starts there, a label, and a comment, which shows as a marker on the map
(drag it to move the comment) and in the notes below. Replacing the map's picture opens a dialog with both
images, their sizes, what moves with the map and, when the shape differs,
"keep the shapes" (the old drawing is fitted, centred, into the new picture)
or "stretch"; the map is saved as an era first. Saving a shape, or undoing and redoing
it, keeps shapes added meanwhile elsewhere (by the agent, for instance); an
undo leaves alone, and names, a shape that was changed elsewhere after the step
it would take back.
A classic map can have a scale: type how many kilometres the picture spans,
or measure a line you know and say how long it is. With a scale the map shows
a scale bar (also in the SVG export), paths read their length and travel time
on foot, horseback and by carriage, regions their area and perimeter, the
Measure tool adds up legs as you click, and a real place (Iceland, Iberia,
Britain and Ireland, Japan, Europe…) can be laid over the map at the same
scale and dragged around. Paths can be drawn as a road (cased), a trail
(dashed) or a river, with their own thickness and a solid, dashed or dotted
line. A route or region is drawn click by click: Enter finishes it, Backspace
takes the last point back and Escape cancels; once drawn, pulling a halfway
handle bends it with a new point and a double-click removes one. A pasted map key ("A. The Old Mill", "B) Crossroads Inn")
names the pins still called by their letter or number, after a preview.

A generated world remembers its look (style, layers, relief density, 3D skin)
for every view and export; an era that still inherits the world shares Base's
look. Worlds can start as a blank sea or blank land and be painted with the
Coast brush; continent-shaping controls are off until continents are generated
again. The ruler encloses areas (a ring round a pole measures the cap) and can
lay a real outline such as Iberia or Japan over the map at true scale. Each
world keeps its own travel settings (usual pace, speeds per mode, ground costs);
journeys take a pace, a mode per leg and rest days, and saved itineraries keep
the settings they were planned with. A planned journey can be played day by day:
a banner follows the route, stops each night where the planner put it, rests on
a hard pace's rest days and arrives, with a caption of what the party is doing.
A square or hex play grid of any size in km can be laid over the atlas, the
Carta and exports, and is saved with the world's look. Hand-drawn map eras can stand for timeline
events: they order by the world calendar (each event in its own timeline's
calendar), play in sequence and keep their date if the event is deleted. The Biome brush has a row of fantasy grounds (volcanic badland, ash plain,
petrified forest, fungal forest, crystal flats, glow marsh) that travel like
dry ground, forest or marsh. The Relief tool's "Plateau" sets a square, flat-edged
head in one click (Ctrl cuts back). A readout on the atlas names the band the
view is in (world, continent, region, local) and how many km across it is. The
toolbar's contour choice draws lines of equal height every 100, 200, 500 or
1000 m (an index line every fifth) on the atlas, the Carta and the PNG export,
in place of the look's own, or takes all contour lines away; it is saved with
the look. In the World 3D tab, on the plane with the whole world in view, the
world is a tabletop model by default (Maqueta): a block whose walls show the cut
— the water column where an edge falls in the sea, a band of soil, wavering rock
strata and a darker plinth — on a lit table with a soft shadow, in a quiet room,
with the sea ending at the block. Paisaje gives the landscape reaching to the
horizon instead; the choice is saved with the look. Closer in, the view is a
landscape either way. The Pintado skin paints the whole world as a relief map
(grounds blended and grained, rock and snow on the heights, a pale shelf and
light rings along the coasts, crowds of small broadleaf, conifer, jungle or
fungal trees in the forests, dunes in the sand seas) and lays its sea flat at
sea level; closer than a region the satellite tiles take over to bring the
towns and streets. Over the Pintado and Dibujado skins the names are lettered
like a map (dark serif ink on a paper halo), and both show the colours they
have in 2D. Volcanoes, caves, waterfalls, gorges and hot springs keep
the 2D map's marks in 3D, and a road across the date line is cut there rather
than drawn back across the sheet. On classic image maps, a pin linked to an
entry with a picture shows that picture framed in the pin's colour with its name
under it; the Portraits and Names layers turn that off and every pin name on.
Point → Label
has a Roll button beside the text: it coins a name for a Region, Water, Range or
Place label in one of the world's own languages (each roll walks through them),
never one the map already uses, and shows its language and etymology. A label
the author placed is always drawn on the atlas, even where it overlaps another
(a long curved name covers a lot of map). The
Labels tool picks a painted label and turns, spaces, sizes and curves it with
handles or exact values, in the atlas, the Carta and the 3D view. Point → Stamp
places one of 32 pictures (settlements, places such as inns, shrines, mills or
barrows, forts and nature) in three sizes with an optional name; stamps move,
rename and erase like other painted objects and show in every view.
The Fog brush (Paint → Reader) marks ground as seen, heard of or hidden again,
optionally from a chapter on; Ctrl hides. "Reader's view" in the map toolbar
shows the atlas and the Carta as the reader knows them up to a chosen chapter:
blank paper where the story has not been, a wash over what is only heard of,
with names and pointer hits hidden under the paper. How the reader's map starts
(blank, all heard of, all seen) is saved with the world's look, and the Carta
PNG export carries the reader's view while it is open. The Travel panel tells
the planned journey in words: one sentence (across which grounds, along the
road from which town to which, how far by water, how many rivers forded, bridged or crossed frozen), the
towns it passes with how far along, each stretch with its day and part of day,
and when the party sets off, makes camp and arrives (the set-off hour is in the
travel settings and is saved with an itinerary); a night near a town is at its
inn, near a ruin in its shelter. In the Travel panel,
"Mark the route as seen" paints the planned route into the reader's map with a
sight radius in km, from a chapter on; a long route is stored as several
strokes so it never folds across the sheet. The fog changes nothing in the
world; the 3D view does not draw it (the fog and event tools say so there).
Right-clicking a generated world's map offers, at that spot: a village (on dry
land only), a note, a story event (in the Reader's view, in its chapter) and a
spring whose river runs downhill on its own until the sea, another river or a
hollow; Escape closes the menu.

A river crossed off the road is a ford and costs the party time (an hour and a
half on foot, an hour on horseback, about four with a cart); on a road it is a
bridge and costs nothing, and in a hard winter a frozen river is walked over. A
diagonal step between two river cells is a crossing too. Right-click near a
river: "No crossing here" closes the river there (a ford washed out, a bridge
down) and marks it with a red cross; journeys then find another ford or bridge,
or report there is no way, while a stop placed on the closed stretch itself (a
town or a via point) can still be reached and left. Right-clicking it again opens it. Laying out a road bridges what it
meets, closed or not.

A place's card (Index, or the Place tab) can Duplicate a town, ruin or
landmark (a copy named "<name> 2" on the nearest free dry land; a capital's
copy is a city) and Lock it: a locked place is not picked up by the Move tool
(a note says why) and no card, sheet or eraser click hides it until it is
unlocked; an agent is refused the same way.

Paint → Whole world moves the sea level (±1000 m: every height shifts, so coasts
drown or shelves come up and the biomes follow, on the region sheets too; a lake
the sea covers comes back when it goes down; rivers keep their courses until
Recalculate climate and rivers) and the snowline (±3000 m: higher means less
snow; only where snow is drawn changes). Each move is one undoable edit,
written when the slider is let go.

The River tool (Paint → Stroke → River) has a Water row: Draw a river, or
Lake. In Lake mode a click runs a few cells down to the bottom of the hollow it is in
and fills it until it spills (into the sea, it is a lagoon); with no hollow that
close the lake is dammed where you clicked (the Least size slider makes the water rise until it is at least
that big); a lake that would touch another is refused; Ctrl+click drains the lake you click,
painted or generated. The lake is re-derived from the ground on every replay,
so it follows later terrain edits and survives "Recalculate climate and
rivers".

In the Travel tab the ends and the stops of a journey can be towns or points of
open ground (click the land while choosing); the stops are listed in order with
earlier/later arrows and a remove button, and the legs follow.

The Road tool (Paint → Point → Road) lays a road between two towns along the
cart route, or by hand with a drag; a track is dashed and a royal road solid,
unless the Line row picks solid, dashed or dotted, and Thickness scales its
line (×0.5 to ×3). The road keeps that look on the map, in 3D and on the Carta.

The Events tool (Paint → Reader) puts story events on the map: a kind (fight,
find, meeting, rest, change, travelling, camp, inn, other), a title, a chapter
and planned or happened; a click places the next one, picking one edits it in
the inspector (title and note are saved when the field is left), dragging moves
it, and the list shows the story so far by chapter. Inside a chapter the ↑/↓
arrows put an event earlier or later; "Who was there" adds characters and
factions from the Codex as chips (the list shows how many, the playback caption
names them). The Reader's view marks the
events that have happened by its chapter and hides the planned route, journey
pins, banner and other author marks. Its Previous, Play and Next buttons step
through the chapters that have events or fog: the map follows what happens in
each and a caption names it; playing advances a chapter every few seconds and
stops at the last. A scrub bar beside them jumps to any of those chapters, and
the caption also says what the story has planned next (the first planned event
in that chapter or a later one). The Carta PNG export carries the events
shown on screen: those known by the chapter in the Reader's view, all of them
while the Events tool is out, none otherwise. In the curved projections (Robinson,
Mollweide, azimuthal) the atlas draws the fog and events through the
projection; the play grid, route and banner show on the equirectangular and
Mercator atlas and on the Carta.
The Trade tab is a deterministic economy over the settlements: each opens
farms, fisheries, pastures, logging camps, quarries, mines and saltworks near
it according to the ground, and month by month it eats, stores, and buys from
its neighbours by road or, between ports, by sea. The tab plays or steps the
months and lists who is fed and who goes short of a staple (grain, meat,
salt) and in how many months, read off the simulation itself with trade
included; prices against the usual, goods nobody makes (with the kind of site
that would make them), and the sites of a settlement. Farms, pastures and
fisheries feed their own town (villages and towns grow a surplus for the
cities, which also draw on farms and herds in a hinterland); where grain will
not grow, people live on fish and herds instead, and the lens says so. Logging
camps, quarries, mines and saltworks are few and supply a region. Distances
(working radius, hinterland, regional reach, road range) are in km, so a world
of any size behaves alike. A generated site switched off can be switched back
on from its settlement's sites. The author can place sites on the map
or switch generated ones off; both are undoable world edits that change
nothing in the terrain. The atlas (equirectangular and Mercator) and the Carta
draw the sites and that month's shipments.

Graph filters include concrete custom types and descendants. Relation trees
create connected neighbors in four directions and reconnect edge endpoints;
Escape cancels a reconnection. Timelines support keyboard and native horizontal
scroll/modified-wheel zoom without changing browser scale. Tables retain typed
values, calculations and scoped references. Dictionary entries support local
scripts and manuscript glosses. Boards, voice memos and supported3D formats keep
their ordinary local editors and playback.

## Character sheets

Existing presets and manual values remain valid. The optional **5e (2014),
SRD5.1** profile covers twelve core classes and levels1–20, explicit previews,
fixed HP/hit dice and full/half/Pact slots. Manual maxima detach calculation;
played counters, labels, custom resources and spell rows survive changes.
Reducing a capacity that would discard spent uses requires selecting that
change. Class or level changes never silently heal, rest or reset a character.

Spell rows have their own level and prepared mark. Casting follows stable
ability IDs and supports explicit DC/attack overrides. Paper, Reader, wiki and
PNG retain the spell's authored section. This is not a complete spell catalogue,
multiclass/subclass adjudicator, feat system or automatic combat engine. Source
and attribution: [2014 profile](../src/engines/character-sheets/FIVE-E-SOURCES.md).
Daggerheart class previews, CoC and statblocks keep their separate rule scopes.

## Import, recovery and export

Mixed folder/file/ZIP import reviews Markdown, JSON, CSV and media before creating
Codex entries, chapters, tables or timeline events. Review types, destinations,
exclusions and CSV mappings. Source filenames and originals remain associated
exactly, including names containing `#`. Missing reused media is checked again
at commit. Import is create-only; it is not a live synchronization engine.

DOCX review preserves the original source and supported editorial structure,
including revision decisions and comments. Unsupported Word features do not gain
universal fidelity by being imported. Document history and Archive are separate
recovery paths; they retain version scope and fail honestly on conflicting edits.

Project/full ZIP use registered engine strategies. Legacy project/full JSON have
partial table coverage and must not be described as complete-project duplication
or a universal backup. New optional authoring sidecars survive supported exports;
same-ID legacy restores preserve absent sidecars, while explicit null resets them.

Reader and static wiki have local typography, appearance, chapters, references,
supported media/models and frozen editions. Full-document PNG export covers the
supported document kinds and paginates long content. Remote hosting, multiplayer,
third-party streaming accounts and arbitrary server tools are outside these local
workflows. Production packaging and installed behavior need their own checks;
feature test results alone do not certify a released executable.
