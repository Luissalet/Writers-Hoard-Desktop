# Incorporated publishing MCP connections

Version 0.1.6 keeps the existing MCP server IDs, enabled flags and disabled-tool selections when the operator updates their command and token-file path. The desktop app and its native modules remain under explicit user control. Registering MCP or listing tools starts neither the desktop nor a worker.

Use the installed adapter (outside `app.asar`):

```text
node <installation>/resources/app.asar.unpacked/dist-electron/aibridge/mcpStdio.cjs --publishing-module borges
```

The mode `borges` preserves the complete earlier catalogue: 375 native Library, Links and Paperwork tools plus `borges_modules`, `borges_set_module` and `borges_search_all` (378 total). Its control schema still names only those three modules. `borges_search_all` with all three OFF returns their disabled states without starting a worker. The existing explicit module control continues to work.

Separate connections can use `library` (15 tools), `links` (46), `kafka` or `paperwork` (314), and `gutenberg` or `publishing` (19). Each exposes its original names, schemas, annotations and declared native timeouts. The normal adapter without this option still exposes Writer's full catalogue.

`WH_BRIDGE_URL` selects Writer's existing bridge, normally `http://127.0.0.1:8766`. `WH_BRIDGE_TOKEN_FILE` points to the existing Writer bridge token; `WH_BRIDGE_TOKEN` remains available. Native tokens and copilot space IDs stay in their migrated data trees. This configuration does not rotate them or enable the bridge, connections or native automation.

Hub aliases use Writer's `/compat/<mode>` base. Its `/api/health` and `/api/agent/tools` are static and never activate a module. `/api/agent/call` preserves the legacy name, arguments and caller context and dispatches to the incorporated native route. A module must already be ON; an OFF call returns an error without starting a worker. The existing bridge and write switches remain effective; switching writes OFF still permits native tools annotated read-only. The native result is returned with MCP text and structured content for object results. Errors that report an uncertain write keep `outcome_unknown` and `reconcile_action`; the adapter never retries a write. Native `x-timeout-s`, `wait_s` and MCP progress tokens remain supported.

The family identity headers use `HOARD_AGENT_ID` and `HOARD_AGENT_SESSION`. Per-call `_meta` keys `hoard/agent`, `hoard/session`, `hoard/reason` and `hoard/caller` can provide that call's context. Header identities use the existing family's ASCII/80/120 limits. Reason and caller accompany the native request, without modifying tool arguments.

A connection failure before contacting Writer reports `app-closed`. Once a connection exists, a write whose response is reset, aborted, incomplete, invalid or timed out reports `outcome_unknown:true` and `reconcile_action:read_current_state_before_retry`. This applies to both global and legacy MCP calls. The adapter does not replay the request. Lost read responses report a transport error without claiming an uncertain write. Run `node scripts/run-mcp-http-tests.mjs` to exercise twelve actual socket cases using only synthetic listeners; no native operation is applied. `WH_MCP_HTTP_NODE` and `WH_MCP_HTTP_ADAPTER` can select the packaged executable and unpacked adapter for the same regression.

Run `node scripts/run-publishing-compat-tests.mjs` under the reserved test app/port. It tests real Electron sandboxed preload, the three production IPC callbacks, the actual custom protocol handler, HTTP bridge, Node MCP adapters and frozen worker, using only a new synthetic profile and port 64852. The main callbacks are extracted verbatim for the contract fixture; the fixture has its own sender guard and does not run the complete main application. This verifies the native API contract, not Windows GUI interaction, a complete app startup or installer wizard operation. It never opens origin 5174 or the personal Writer profile.
