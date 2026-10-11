# Shared Faustus copilot

Writer's desktop dock is a host for Faustus's shared web component, loaded from
`/api/hoard-copilot/panel.js`. The host contributes domain context and native
operations; it does not select an LLM, replay model history or execute an agent
loop. Faustus supplies the conversation controls, composer and transcript.

Electron's main process owns the Faustus connection. The preload relays Fetch
requests and response chunks, including SSE, without giving the renderer a
connection token. Cancelling a transport subscription closes that observer;
stopping a turn uses Faustus's normal stop operation.

Configuration:

| Variable | Meaning |
| --- | --- |
| `WH_FAUSTUS_URL` / `FAUSTUS_URL` | Faustus service; default `http://127.0.0.1:7000` |
| `FAUSTUS_TOKEN` | Existing Faustus connection token, when required; stays in main |
| `WH_FAUSTUS_MCP_SERVER_ID` | Registered native Writer tool server for this data space |
| `WH_AIBRIDGE_PORT` | Existing Writer bridge listener; default `8766` |

The data space is a UUID persisted in the Electron profile's
`faustus-data-space.json`. Port and project title are not identities. A separate
QA profile gets a separate identity. Restoring the profile preserves its identity.

The context provider reads the current project and active object when a turn is
sent. A manually opened manuscript is resolved from its registered live editor;
other domain objects retain their existing deep-link identities. Text selections
use ProseMirror positions and explicitly declare `unit: prosemirror`, rather
than pretending they are offsets into exported plain text. The native
`wh_get_context` tool exposes the same context alongside its previous fields.

Opening the copilot enables Writer's existing bridge with full access. Faustus's
registered Writer connection uses the official MCP stdio adapter and the existing
profile token file. It does not need a second catalogue or tool executor. The
bridge returns an additive `auditIndex` receipt; the MCP response carries it as
`_undo: {app_id: writer, audit_index: N}` so the shared panel can invoke native undo.

Each old thread is imported through `/api/hoard-copilot/imports`, with stable
source thread/message ids and its chronological messages. Tool calls, result
cards, undo handles, failures, usage and previous route information are retained
as metadata. Imports never delete or overwrite the original Writer rows. New
conversation messages belong to Faustus. Writer stores only the selected session
id as a view preference; its backup format and database schema are unchanged.

The old private `copilot:run/cancel/approve` IPC channels, old preload copilot
object and their Electron agent-loop imports are retired from the application
bundle. Their only application consumer was the replaced dock. Stored-history
types and regression fixtures remain available; they are not another running
copilot. Public Writer HTTP/MCP tools and the separate image runtime remain
available through their existing paths.

Verification commands:

```text
node scripts/run-faustus-copilot-tests.mjs
electron scripts/run-focused-browser-tests.cjs tests/faustus-copilot-context.browser.ts testFaustusCopilotContext
electron scripts/run-focused-browser-tests.cjs tests/faustus-copilot-dock.browser.tsx testFaustusCopilotDock
npm run verify:quick
npm run test:critical
npm run build:desktop
```

The isolated native integration fixture is
`electron scripts/run-faustus-copilot-native.cjs`. Set `WH_FAUSTUS_URL` to an
isolated Faustus service and `WH_QA_DIRECTORY` to a dedicated profile; never point
this QA fixture at the production conversation store. It mounts the full Writer
application with compiled CSS in a hidden window, uses real preload, bridge,
MCP and IndexedDB, and provides a test control endpoint for observing the shared
session, selecting text, sending a turn, undoing it, reloading and capturing the
rendered result. It does not load a model or show a window.
