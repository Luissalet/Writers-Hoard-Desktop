# Interactive fiction in Writer

Writer incorporates the world-state engine and all twelve views formerly in
Scheherazade's Hoard: entities/secrets, facts/provenance, relations, chronology,
scene/cast, sessions/turns, transactional deltas and undo, threads, clocks, random
tables, dice, continuity checks, narration, manuscript/bible/JSON exports, world
exchange, voice, illustrations, backend settings and agent activity.

Open **Interactive fiction** in Writer's sidebar. It is also an optional project
engine. Four independent controls start **OFF**: Worlds and play, global model
narration, read aloud and illustrations. Nothing starts from MCP discovery, a
catalogue read, a status request or importing the engine definition. Visiting the
OFF page does not open a fiction database. Enabled features act only when used;
there is no scheduled collection, polling or model loading.

Narrate is disabled with a visible explanation while global model narration is
OFF. Switching that control updates the open play view immediately. Before
appending an unsent draft, Narrate also checks the owner's current module state,
so another client's OFF change cannot turn that action into a manual write.
Send remains available for writing turns manually with narration OFF.

## Data stays in place

Writer's renderer origin, IndexedDB schema, profile, manuscripts and document
engine are unchanged. Fiction keeps the existing `scheherazade.db` format and
related audio, token and settings files. No import or copying is needed: while
Worlds and play is OFF, choose the previous Scheherazade `data` directory in the
page's data settings. New users default to `<userData>/fiction/data`.

`<userData>/fiction/modules.json` contains `enabled` (initially `[]`) and an
absolute `dataDir`. A deployment may write the old directory here with all
features OFF. The former directory is never guessed or searched. Choosing a
directory does not open it; the first explicit world operation does.

`hoard.world/1` refs/revisions remain stable. Existing tools
`wh_world_to_scheherazade` and `wh_world_from_scheherazade` now call the local
engine directly. Moving a world between Writer's codex and fiction requires
neither the old server/repository nor the Hub. Optional reference links still
go to the Hub as before.

## Owned runtime and interfaces

`story/writer_story` is detached MIT source, recorded in `story/PROVENANCE.json`.
It runs as a private stdio child of Electron, without an HTTP listener. Keeping
the Python core preserves SQLite transactions, undo, dice/parser semantics and
existing worlds. The complete React UI renders inside Writer's tree with
isolated shadow styles; no iframe or second UI server is used.

The installed app bundles an owned worker executable/interpreter. A development
checkout runs `npm run fiction:setup` once; `build:desktop` builds the worker
before packaging. No installed Python or old Hoard is needed at runtime.
Disabling a feature waits for active requests. Disabling Worlds and play and
quitting Writer close clients, SQLite and the worker; parent-pipe EOF also closes
the worker. A catalogue/status read never launches it again.

Writer's existing MCP tools remain, including the 19 original fiction tools
with their original names, return shapes and annotations, and two controls:
`wh_story_modules` and `wh_story_module_set`. Three additive tools manage session
preparation, attendance and recaps. The compiled catalogue is available even
with Writer closed. Calls use Writer's existing bridge/token.
Its existing write switch applies to new tools too.

The native REST API is under the same Writer listener: `/api/fiction/worlds`,
`/api/fiction/worlds/{id}/entities`, etc. mirror former `/api/*` paths.
`/api/fiction/modules` reads/changes switches. Audio and Markdown export retain
their content types. UI requests use the same ASGI endpoints over Electron IPC.

The Faustus button uses the family's canonical mark and connects only when
pressed. Fiction retains its old `copilot-space-id`, app identity and per-world
project ids for conversations already stored in Faustus. Context includes the
active world, entity, scene/cast, threads/clocks and unsaved public form fields;
GM secrets stay excluded. Turning fiction OFF removes its view/refresh hooks.

## Models and limits

Narration, polishing and the optional continuity judge use the global family
model through Hoard Hub, with no local text-model fallback. Existing backend
settings remain readable/editable, but the global model policy determines
execution. Voice/illustrations retain Prospero integration when explicitly
enabled and available. Migration starts no provider, Sparks, GPU or model.

Original limits remain: one local writer, lexical context ranking, sequential
non-streamed narration, current-session undo without redo, and full JSON imports
that preserve sessions/turns without replaying undo history. World exchange omits
secrets, pictures, facts, clocks and sessions by design; full JSON is the archive
route. Synthetic-provider QA does not certify real models or media hardware.

## Verification

`npm run test:fiction` runs the actual Electron bridge/MCP stdio with an isolated
profile, synthetic worlds and a synthetic family endpoint. It exercises all 19
native tool paths, REST, optional narration/voice, in-place reopen, all-OFF
startup, the complete Writer renderer and joined worker shutdown.
`npm run test:fiction -- --packaged` repeats with the bundled executable.
Core/API regressions import the incorporated `writer_story` package; the former
standalone launcher/logging entrypoint is not shipped.

## Session preparation, attendance and recaps (1095)

Fiction → Sessions now distinguishes **Plan session** from the existing **Start
new session**. Planning never changes the current session for new turns. Open
**Preparation and recap** to record a scheduled local date/time (stored as UTC
seconds with the computer's time zone), duration in minutes, place, opening hook,
private GM notes, status and attendance. Attendance can use player names alone
or link to characters in the same fiction world. Old sessions remain
unclassified until edited; their original rows and timestamps are unchanged.

Starting a chosen session explicitly selects it for new turns. Marking it played
sets its end time if absent and deselects it only if it was current. Returning it
to planned deselects it without clearing historical timestamps. Changes to
unrelated preparation fields preserve the current session. The outline-based
Session planner remains a separate preparation view.

Selecting a new live session also marks the previous current session played and
sets its end time if it had explicitly been marked live in preparation. This
transition preserves all turns and recap drafts. A legacy current session without
preparation details is left unchanged. The preparation form states this behavior
before starting; planning alone never completes another session.

Recaps are written by the author, with no model call. **Save preparation and
draft** saves the text; **Save recap as ready and mark played** atomically makes
it ready to share locally and marks the session played. Nothing is sent or
published externally. Editing ready text returns it to draft unless explicitly
marked ready again. A separate Markdown download contains only the saved recap;
draft downloads are explicitly labelled. Chapter exports keep their original
transcript behavior and never substitute the recap.

GM notes are excluded from Faustus form context, recap downloads, chapters,
bibles and the default results of the new tools. A deliberate
`include_dm_notes:true` reads them through `wh_story_session_list`. The complete
private JSON archive retains them. Full JSON archives add an optional
`session_details` collection while preserving the existing `sessions` shape;
imports remap session and attendance character ids, retain names without a
surviving character reference, and never activate an imported session. Old
archives without the new collection still import.

The new tools `wh_story_session_list`, `wh_story_session_create` and
`wh_story_session_update` share the native API implementation. They add to the
19 original fiction tool schemas, descriptions, annotations and return shapes;
those original contracts are frozen in the regression fixture. Metadata lives
in a companion SQLite table, created only when the existing fiction worker
opens a database on explicit use. Catalogue/status reads and enabling the module
do not open or migrate a database.

Characters also accept the additive `retired` status (`retirado`/`retirada` are
normalized). The Bible status selector and an explicit per-character session-end
action use the existing entity update operation. Retired characters remain
readable, searchable, available to explicit scene context and included in full
archives; no character is deleted or automatically retired when a session ends.
The original `entity_upsert` schema remains an open status string and its
historical description remains unchanged.

Native endpoints added: `GET /api/worlds/{world}/session-details`,
`POST /api/worlds/{world}/session-plans`,
`PATCH /api/worlds/{world}/sessions/{session}/details`, and
`GET /api/worlds/{world}/sessions/{session}/recap.md?draft=false`, plus the three
matching agent routes. Writer's `/api/fiction` transport mirrors these routes.
New list results use `{sessions:[{session,details,is_current}]}`; a legacy session
has `details:null`. A partial update omits unchanged fields; null clears the
scheduled instant/duration, empty strings clear text and attendance `[]` clears
the roster. Status values are `planned`, `live`, `played`; `recap_posted` is the
stored local ready flag, not an external publication receipt.

CPU regression commands: `python tests/test_fiction_sessions.py` and
`node tests/fiction-session-contract.node.cjs`. The first uses fresh temporary
SQLite databases and ASGI without providers; the second verifies all 19 original
contracts and excludes private notes from form snapshots. The browser fixture
`tests/fiction-sessions.browser.tsx` covers save errors, attendance, recap status
and the explicit retirement action. Real transport/UI validation is recorded
separately; CPU tests do not certify live models or external services.
