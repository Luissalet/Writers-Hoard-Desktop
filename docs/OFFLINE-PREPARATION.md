# Offline preparation — task1095

This extends the existing Writer desktop. It does not update an already installed executable or migrate a real profile.

## Wiki pages

Open Codex → Export wiki, create a named profile and expand Documents and multiple selection. Select visible results, include/omit them, or move them to a manual section. Sections and order supports parent/subsection choices, native drag and accessible arrow/select controls. Save preferences before publishing the saved configuration. Preview/download accepts a profile containing only selected extra documents.

Supported additional kinds: notes, tables, board, timeline, character-sheets, dictionary, relation-tree, radar, model-viewer and local-tool (with namespace). Timeline articles already existed through includeTimelines; they now join curation without duplicate pages. Boards are complete semantic lists of visible cards, not spatial canvases. Soundscape, manuscripts, diary and generated-world pages are not added here. Only-revealed profiles omit extras without a reveal contract. Navigation-only hiding is not secrecy; do-not-publish sections and their children remove their semantic references and assets before hydration. Free prose written in another admitted document is not inferred to be a secret reference.

Pages use the effective captured source, immutable edition/digest and existing profile/source CAS. Unknown/missing/foreign sources cannot fall back to live Base data. Full tables/dictionaries/boards use page projections, leaving embedded previews at their existing sizes. Project JSON/ZIP and duplicate keep/remap references and nested sections; frozen edition HTML and digests remain unchanged.

## Home and Library

Overview aggregates real createdAt dates for extant writings, scenes, Codex entries, notes, outlines and research sources. Undated records are counted separately; deleted history and connection/word growth are not reconstructed. Quick creation supports writings/notes in Base or an explicit active era and outlines in Base only, with enabled-engine checks and normal persistence/history operations. A search containing recognized filters, exclusions or quoted phrases does not offer quick creation. Plain text keeps accents/case. Other engines use their normal editors.

Next action derives from current counts/health and available tools. Tips advance manually. This is authoring guidance, not availability polling, invitation or a fiction scheduling assistant. Library context bookmarks reuse existing placements/CAS and can be undone only while their revision matches. Opened-from-Library is window-session memory, project/era scoped; it excludes documents opened elsewhere and is not a durable reading log. Rules entries, grid bookmarks and arbitrary right-click bookmarks across every editor remain outside this change.

Workspace Appearance adds effect none/snow/rain/embers/fireflies and intensity0–100. Defaults are unchanged. Performance mode or the app's reduced-motion preference removes particles; system reduced motion hides them. Effects do not intercept input. Other particle families and campaign/session banner crop remain open.

## Fiction sessions

Interactive fiction → Sessions keeps original new/start/rename/chapter export. Plan session creates a planned record without changing the current play session. Preparation adds scheduled UTC instant with the computer's timezone label, duration, place, hook, DM notes, status, attendance by name and optional character link, and a manual recap. Editing a date in another timezone uses that computer's local time; arbitrary IANA conversion, ICS and RSVP are not implemented.

Starting explicitly selects this session for new turns. If the previous current session had preparation status live, it becomes played and keeps its text/times; legacy sessions without details remain intact. Returning current to planned deselects it without clearing historical timestamps. Mark played ends/deselects only the relevant current session. Recap-ready atomically saves a nonempty manual recap and marks played; it sends nothing. Editing a ready recap returns it to draft. Downloaded recap is only the saved text (draft download is explicitly labelled), never DM notes or generated narration. Retire buttons affect linked attendee characters explicitly and keep their entities in the world.

The session_details companion table is created only when fiction's own store opens. Original sessions columns,19schemas/descriptions/annotations and original return shapes stay exact. Full private fiction JSON adds an optional session_details collection and remaps sessions/character attendance on import; old JSON without it still imports. Project IndexedDB backups do not contain the separate fiction SQLite store. DM notes stay out of Faustus form context and default agent responses; explicit include_dm_notes reads and the private full JSON retain them. No model, network calendar, multiplayer identity, recap comments, automatic end-of-session statistics or fiction/outline merger is added.

## Bridge additions

While the Sessions view remains mounted, closing preparation or switching sessions retains unsaved values and errors in a private world/session cache. Reopening reconciles the saved baseline without allowing an older request to overwrite a newer draft. This cache does not promise recovery after reloading or restarting the application.

- wh_project_home reads monthly document counts, next action, available quick creation and fresh Base Library-session references.
- wh_project_quick_create takes projectId, optional eraId, engineId(writings/notes/outline), text.
- wh_story_session_list takes world, optional session and include_dm_notes(defaultfalse).
- wh_story_session_create takes world, optional title/details and creates planned only.
- wh_story_session_update takes world, session and partial patch.
- wh_wiki_profile_get includeDocuments:true returns the effective catalogue of refs/titles; save accepts additionalDocuments/excludedDocuments and section parentId.
- wh_workspace_appearance_save patch accepts effect/effectIntensity via the existing CAS operation.

The catalogue remains pure data in Node. Existing tools and native controls remain available. Verification and exact review evidence are in tasks/vvd1095/verification-next.md.
