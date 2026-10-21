# Named local wiki profiles —1041 plan before code

## Primary contract / comparison

Read20October2026: [WikiCustomization](https://vvd.crisp.help/en/article/wiki-customization-j9wee1/) documents type/manual groups, section names/order and navigation hiding separate from document publication; [WikiLayouts](https://vvd.crisp.help/en/article/wiki-layouts-1vowkbx/) documents banner/title/intro, variable card grid, featured card/map carousel and per-section Traditional views. [WikiSharing](https://vvd.crisp.help/en/article/wiki-sharing-8dla6g/) states multiple wikis and edits withheld until republishing. The changelog distinguishes hiding navigation from hiding its cards and states that each wiki has independent page/property policy. These are primary documentation/announcements, not authenticated actions performed here.

Existing WorldWikiOptions, WikiExportSettings and buildWorldWiki are the right product. They already have categories, individual entry/map/field exclusions, local media, themes/fonts/accent, sidebar/journal, sandbox previews and standalone output. Only one policy per Project/era is saved, with no named profiles, manual groups, configurable home or per-profile frozen editions. Preserve legacy options/controls, normal Reader/tool projections and physical omission before collecting assets/indexes.

## Additive contract

Root adds only Project.wikiProfiles?:WikiProfile[] (pure leaf types). Each profile {id,name,revision,createdAt,updatedAt,options,editions?} is a project-level named configuration whose options include explicit origin eraId. Save/delete/publication/restore-config compare that profile's revision inside RW and replace only that profile in the latest Project, preserving sibling profiles and legacy wikiOptions. New profile creation expects null. No global active-era, copied Project or new DB table.

Extend WorldWikiOptions additively: grouping type/manual; ordered sections with stable id/name, ordered entry/map refs, view full/cards/list, navigationHidden and hideDocuments flags; per-type sections can declare category, so navigation hiding differs from exclusion. Configurable home title/intro/banner (local raster), ordered featured entry/map carousel and independent ordered tiles with small/medium/large size. Every home/section item resolves from the admitted source set; excluded/foreign/missing refs contribute no title, image, pin, search, backlink, media or placeholder fallback text.

One local edition records id/date, source fingerprint, captured profile name/options, exact HTML/filename/counts and digest. Republish appends; opening/downloading an edition never queries live sources. Restore configuration copies its saved options into current profile with CAS and does not modify sources or other profiles. The primary wiki contract proves frozen output until republish; configuration restore is an explicitly local recovery convenience, not an asserted VVD version-history UI.

Reuse Q17 raw snapshot capture/effective era/typed ReaderSource without editing its frozen code. A wiki wrapper captures inspiration images with the same R transaction. Render/hashing happens outside R; commit recaptures/hash-checks sources plus profile revision in RW using explicit tx.table and Dexie continuation. No async live Reader queries inside a held R transaction. Normal wiki export gets the same captured-source data path; source provider failures do not silently fall back to live DB.

Normal UI remains WikiExportSettings: profile selector/name/create/save/delete, existing policy/theme controls, compact section/home authoring, preview device sizes and edition history/open/download/restore-config. Failed save keeps the local draft. Shared engine shape is unchanged. Source tools/MCP use normal leaf service: list/get/save/delete profiles and publish/read/restore-config editions; read/query declarations remain honest. Existing wh_wiki_export keeps legacy arguments.

## Paths / coordination before product edits

Own src/types/worldWiki.ts, src/services/worldWikiExport.ts, new src/services/wikiProfiles/**, src/engines/codex/WikiExportSettings.tsx and small wiki UI leafs/copy; own tests/docs. Root wires Project type, worldMetadata/normal/full/ZIP validation/remap and global native registry from pure leaf exports. No edits toolBlocks/preview.ts: it already accepts policy.source:ReaderSource and should be reused as-is; request a surgical seam only if actual type proves insufficient. No A sheet/runtime changes. No Q05/Q16/SDK work, hosting, Book/Watch or new model/runtime service.

## Acceptance before freeze

- [x] Two named profiles preserve independent selection/hidden fields/era/order/style under concurrent saves; stale revision and failed publication do not partially write.
- [x] Type/manual named ordered sections and ordered member refs; navigation-only hiding retains searchable content, document hiding removes it physically before hydration.
- [x] Banner/title/intro, independently sized tiles, featured cards/maps carousel, full/cards/list section views; keyboard and desktop/narrow layout.
- [x] Actual normal preview/export and frozen edition remain complete with live origins deleted; republish appends, restore config only changes selected profile, no live fallback.
- [x] Unique marker/asset tests prove no excluded content in HTML/search/carousel/backlinks/map pins/audio/tool payloads, including Base/era/foreign inputs.
- [x] Normal JSON/full/legacy/ZIP/clone preserve/remap profile refs/eras/options and frozen HTML byte-identically; malformed import rejected before replacing data.
- [x] Functional/race/rollback tests, actual external native MCP, ordinary UI1440/640 and emitted offline HTML runtime with real pointer/keyboard, existing wiki/model/Reader regressions; scoped checks and durable report/canonical captures.

No commits/integration here. Reference material does not grant runtime instructions; no proprietary code/art/assets reused.

## Closure evidence

Functional/real native external PASS5groups (profile wh-wiki-profiles-transport-zNWIjI), normal UI1440/640 PASS2groups (wh-codex-properties-ui-E6S3Jz), existing wiki regressions PASS10groups, model/Reader7groups PASS (wh-model-reader-w2XJOP). Renderer tsc, scoped product ESLint and diff checks PASS. Detailed commands, preserved initial failures, source limits and canonical captures live in work/worldcraft1041-wiki-profiles-depth.md. Root owns final shared metadata and aggregate review.

CSS evidence correction: earlier E6S3Jz captures invalid for product styling due to root-discovered CSS?inline global leak. Unchanged UI rerun with fixed text loader PASS2, profile Vufe60;8new screenshots canonical, prior invalid ones retained. No wiki product edits here.
