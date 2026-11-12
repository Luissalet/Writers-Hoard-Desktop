# Codex world graph fullscreen

## Normal use

Open **Codex → Graph** and choose **Full screen**. Writer expands the owning workspace pane while keeping the same mounted canvas, pan/zoom, filters and selection. In the split workspace, the other pane stays mounted, hidden and inactive. **Graph controls** opens the same filters and view settings inside the expanded pane. Escape from those controls closes them and returns focus to their button. Press Escape again, or select **Exit full screen**, to restore the workspace. This changes Writer’s layout without invoking browser fullscreen.

The existing controls still edit the graph as before. Spacing, display settings and pinned positions retain their project-level persistence; toggling fullscreen itself does not write project data. The Base or era of a pane remains its effective reading scope and does not fork those graph settings.

## MCP contract

Discover visible, ready graph panes with `wh_workspace_focus_get({projectId, namespace:'world-graph', eraId?})`. Omit `documentId`: a world graph target has a project and optional era, and no document ID. If `eraId` is omitted, discovery is not restricted to Base; a Base target omits `eraId` in its result. Pass the observed ephemeral `hostId`, matching scope and `active` to `wh_workspace_focus_set` to expand or restore. The toolbar and MCP observe the same logical state, without acknowledging paint. A hidden, absent or revoked target is unavailable and a request is not queued. Returning to Cards revokes that graph target. There is no new MCP tool, headless pane, saved fullscreen preference or implicit save; Source concentration and table fullscreen keep their existing paths.

## Observed reference and prior Writer state

`REFERENCE-WORLD-GRAPH-FULLSCREEN-r1.md`: the public VVD World Graph 0.1.14 demo showed 16 documents and 127 links, expanded the graph to the 1904 × 777 app viewport with no `document.fullscreenElement`, and retained spacing 1.5 and the original counts on exit. Graph settings remained available. The catalogue's Screenshot button toggled between live and still views; no download was obtained and this does not establish a PNG exporter. No Add to World or Make World Graph operation was used.

`BRAVE2990-r1.md`: the previous Writer source already had spacing, node selection, inspector, zoom/fit and SVG export. The synthetic three-card/three-link graph had no fullscreen/focus action. This cut addresses only the in-workspace expansion, without replacing graph rendering or claiming broader VVD/SDK parity.

## Attributed verification

Receipts are in `Research/writer-parity-20261110/sdk-nonadditive-reference/`.

- `BRAVE-GREEN2991-r1.md`: nine focused checks in the real Writer workspace with Base/Past panes, plus 15 Tables and two Source regression checks. The same canvas, camera, selection, filter, spacing 1.5 and neighboring pane survive entry and exit. The same graph controls open in fullscreen; Escape closes them before exiting the view. MCP uses the visible target in either era; Cards revokes the graph target and toggling does not write project data.
- The same Brave receipt records a 2107 × 863 viewport: the primary canvas goes from 572 × 600 to 1768 × 747 and back, with the exact camera transform `translate(-120.824px, 173.588px) scale(1.22353)`. At 703 × 1000 the companion canvas expanded to 679 × 764 without horizontal overflow; controls and Escape restore were observed. These are desktop viewport observations. The initial selector count and unsettled camera attempts are recorded separately; final assertions use real nodes and a stable camera transform. The viewport was restored and the private fixture cleanup left all 89 tables empty.
- `NATIVE2991-r1.md`, `NATIVE-INPUTS2991-r1.log` and `native2991/run-20261112T022649Z-b9eb12fb/RESULT.json`: 8/8 exact inputs, two keys using real MCP stdio and Writer IPC, 14 IPC replies. Base/Past targets, absent document IDs, era filtering, hidden/missing/revoked targets, UI/MCP agreement, canvas/camera retention and exact project bytes were checked. Revocation returned 401 for each key without IPC; sessions ended, the port closed, 89 fixture tables were empty and the profile was retired. SHA-256 `e08df5e34111ce0c5467400da1526f20011c60a2bb22c200018c72ab161cb7e1`. Native may use the product's worker recovery when the worker file is unavailable; Brave used the ordinary Vite path.
- `VERIFY-QUICK2991-r1.log` and `BUILD2991-r1.log`: both ended with exit 0. Conformance reported 34 engines, 64 engine tables and zero known warnings; the production build completed in 2m 31s.
- `MERGE2991-RESULT-r1.json`: #2991 was approved at exact submission revision 1 and fast-forwarded from `ea6bafc19f8b3c6995a642c8689559d9a6745c80` to `7a2b7477ed38e5bcc5052e72a01283cbb511a45d`. Root verified the eight paths and preserved unrelated work. `MANUAL2991-r1.json` separately verifies Root’s 229-character manual update. No push.
