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

All 203 previous Writer MCP tools remain, plus the 19 original fiction tools
with their original names, return shapes and annotations, and two controls:
`wh_story_modules` and `wh_story_module_set`. The compiled 224-tool catalogue is
available even with Writer closed. Calls use Writer's existing bridge/token.
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
