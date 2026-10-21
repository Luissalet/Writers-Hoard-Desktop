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
