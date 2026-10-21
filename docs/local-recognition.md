# Local image search and entity suggestions

The Gallery can search image content as well as filenames and tags. Choose the
content mode and prepare its model once from its normal controls. Preparation
downloads fixed, verified model files (228 MB); later searches and indexing run
in a CPU worker with no provider or network. The original images and prompts stay
on the computer. Gallery collection filters still apply.

Visual vectors live in a derived cache outside project backups. Replacing image
bytes or changing the pinned model revision invalidates the old vector. A failed
image is reported explicitly rather than silently omitted. Remote image URLs are
not downloaded by this search. Ranking is similarity, not a factual annotation.

The writing editor also offers optional suggestions for new people, places and
organisations. Prepare the separate multilingual NER model once (about178.5 MB).
It runs on the CPU and proposes names from the current prose. Creating a card is
explicit; choose its type before creating it. Suggestions never write a biography,
replace prose or change the editor's Undo history. Editing the text, changing the
chapter/era or disabling detection invalidates pending suggestions.

Project preferences control three independent behaviours: detecting new entities,
showing links to existing cards, and animating new links. Detection defaults off;
existing-card links default on; animation defaults off. Manual semantic links
remain available. Reduced-motion settings take precedence over link animation.
These settings are shared across the project's eras and carried by JSON/ZIP.

Both workers load lazily, report preparation errors and retries, and close when
idle. They do not call the global text model service. Recognition can miss names
or rank an unexpected image; the synthetic Spanish/English and Unicode checks do
not establish accuracy on every manuscript or image collection.

Normal MCP operations use these same product services:

- Visual search: `wh_visual_search_status`, `wh_visual_search_prepare`,
  `wh_visual_search_images`.
- Entity suggestions: `wh_entity_detection_status`,
  `wh_entity_detection_prepare`, `wh_entity_preferences`,
  `wh_entity_preferences_save`, `wh_entity_detect`,
  `wh_entity_candidate_create`.

The manifests are authoritative for argument names and actual registered tool
names. Model revisions, byte counts and SHA-256 hashes are pinned beside each
worker's asset loader; redistribution notices and upstream licences are under
`resources/visualSearch` and `resources/entityDetection`.
