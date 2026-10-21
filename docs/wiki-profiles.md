# Local wiki profiles

Open Codex → Export wiki. Legacy preferences continue to work. New profile creates a named, independent configuration: choose its source era and output language, document/property exclusions, presentation and layout. Save preferences saves only that profile. Reload saved profile replaces the current working configuration with the saved one; a rejected concurrent save leaves the current edits in the form.

Sections and order supports type groups or manual groups, names, ordering, and full/cards/list views. Manual sections have ordered card/map references. Unassigned admitted documents appear in Other documents. Hide navigation removes the navigation group while retaining its documents; hide documents physically excludes those documents before assets and embedded tools are hydrated.

Home, featured and tile sizes configures the title, introduction, local raster banner, ordered card/map carousel and independently sized home tiles. Excluded, absent or foreign references cannot contribute a home tile, title, image or carousel item. Existing image/media switches still apply.

Preview and Download HTML use the current working configuration. Publish saved configuration captures the saved profile and current effective source era, then appends an immutable local edition. If the profile or captured sources change during publication, publication rejects without adding a mixed edition. The edition includes the emitted HTML and its embedded assets. Opening or downloading it does not resolve live sources, so deleting an original card or recording does not change that edition. Republish appends another version. Restore configuration restores that edition’s saved options into the selected profile; it does not restore or change source documents. A removed source era must be replaced with an available era before saving or republishing.

The standalone HTML contains its local search, section navigation, carousel and supported document/tool projections. It can be opened offline. This feature does not upload or host a website. Profile configuration recovery is a local feature; it does not claim an external service’s wiki version-history UI. A working form is not a persistent draft journal.

## Normal API and MCP

`src/services/wikiProfiles/store.ts` is the shared state API. New profiles use `expectedRevision:null`; updates, deletion, publication and configuration restore compare the selected profile’s revision. Concurrent edits to a sibling profile are preserved. Profiles and editions travel in ordinary project/full JSON and ZIP backups; clone remaps source/era/section/profile IDs while preserving frozen HTML bytes.

The registered native commands use that API:

- `wh_wiki_profiles_list`, `wh_wiki_profile_get`
- `wh_wiki_profile_save`, `wh_wiki_profile_delete`
- `wh_wiki_profile_preview`, `wh_wiki_profile_publish`
- `wh_wiki_edition_read`, `wh_wiki_profile_restore_config`

The full options schema is returned by the ordinary tool manifest. Read/preview commands are queries; the other four commands write. The existing `wh_wiki_export` contract remains available.
