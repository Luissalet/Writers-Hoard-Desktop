# Runtime package cold dependency regression

From the repository root, using the same local Node installation as the other test launchers:

```powershell
node --test tests/local-runtime-format.mjs
node tests/local-runtime-packages-native/run.cjs cold runtime-cold-unique-label
```

The [pure format test](../local-runtime-format.mjs) parses the owned B fixture without evaluating its module or factory. It covers canonical UTF-8 bytes, BOM rejection, file and manifest hashes, and the separate Source/1 format.

Native requires the existing Writer Vite at `http://127.0.0.1:63395`. It never starts a server. Use a fresh lowercase label each time; receipts are exclusive files under `runs/` and raw observations stay in the reported temporary directory.

The launcher reuses `tests/local-app-host.native.cjs` through the retained adapter. Two real MCP keys install B (tool) before A (app depending on B), mount the actual Source Host and Surface, then close that process. A second Electron PID opens the same private profile through the normal runtime loader. Fixed content hashes sort A before B, so the assertion detects the original load-order defect. Both modules and factories must execute exactly once in that second process; saved Unicode notes, child presentation and asset bytes must remain available.

All public readonly calls compare the complete persisted database before and after. The sibling project is unchanged, the final 89 tables are empty, and the retained transport checks EOF, key revocation, pending work, server and window closure. Source, Native transport, configuration and these test files are hashed before and after.

This is a private dev renderer on existing Vite with real Native transport and loader. It does not certify built production CSP, the installed Main app, Browser interaction or general SDK parity. Source/1 commands and tests remain unchanged.
