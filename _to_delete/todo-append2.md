
---

# IA local de un botón: Ollama portable embebido + Qwen — 2026-08-21 (tarde)

Petición de Luis: «darle y que descargue un modelo tocho gratuito local».
15 ficheros (2 nuevos, 12 editados, 1 borrado), **sin commitear**.

## Lo que hay

- [x] **`electron/ollama.ts`** (nuevo): el main gestiona un Ollama portable —
      descarga el zip standalone oficial (CLI + CUDA) a `userData` con progreso
      vía `net.fetch` en streaming, extrae con `tar.exe` (fallback
      `Expand-Archive`), y arranca `ollama serve` como hijo vigilado en el
      puerto fijo **11500** (`OLLAMA_MODELS` propio, keep_alive 30m, flash
      attention). Si hay un Ollama del sistema en 11434, lo adopta y no
      descarga nada (`external`). Pull de modelos por `/api/pull` NDJSON con
      progreso agregado por capas (Σcompleted/Σtotal, monótono, ≤10 ev/s) y
      cancelación (Ollama reanuda solo). Chat por **`/api/chat` nativo** (no
      `/v1`: sin `options` el contexto sería 4096 y truncaría manuscritos) con
      `num_ctx 32768`, `think: false` (retry sin el campo si el servidor es
      viejo), timeout 10 min. Guardas de disco con `fs.statfs` (zip×2.5,
      modelo×1.2 → error `no-space:N`). Árbol de procesos matado en
      `will-quit` (lección #15). TODO el HTTP a Ollama vive en el main: el
      renderer empaquetado es `file://` y el CORS de Ollama rechaza origen
      null (pendiente conocido de `desktop-transition.md`).
- [x] **IPC**: namespace `ollama` (8 invokes + 3 eventos push — los primeros
      canales de progreso de la app), duplicado a mano en `preload.ts` y
      `src/electron-env.d.ts` como siempre.
- [x] **Proveedor**: `AiConfig.provider: 'proxy' | 'local'` + `localModel`
      (2 claves Dexie nuevas; default `proxy` → nadie nota nada). `callAi`
      ramifica; `LocalAiError` → clave `ai.localNotReady` vía `safeAiCall`.
- [x] **`src/services/aiText.ts`** (nuevo, puro): `sanitizeModelText` (bloques
      `<think>` cerrados/truncados/huérfanos) y `parseJsonFromModel` (fence →
      texto → recorte primer-corchete-a-último; `SyntaxError` para mantener el
      mapeo a `ai.unexpectedFormat`). Sustituye los dos `JSON.parse` frágiles
      de `aiFeatures.ts`; `callAi` sanea SIEMPRE (inofensivo con Claude).
- [x] **Catálogo** (`config/ai.ts`): `qwen3.5:35b-a3b` (~20 GB, el tocho, MoE
      3B activos) y `qwen3.5:9b` (~6,6 GB, entero en la 4070 Ti). Tamaños
      espejados en `KNOWN_MODEL_BYTES` del main (mantener en sincronía).
- [x] **UI** (`SettingsModal`): selector de proveedor + panel local por estado
      — CTA «Descargar motor de IA local (~1,5 GB)» → barra estilo worldgen
      con fase/GB/cancelar → «IA local activa»; tarjetas de modelo con
      Descargar/progreso/Usar/Borrar (ConfirmDialog), modelos extra de un
      Ollama externo listados aparte. `aiStore`: eventos suscritos a nivel de
      MÓDULO con guarda en window (StrictMode, lección #19).
- [x] **Borrado**: `AiSettings.tsx` (fork muerto de la UI, cero importadores)
      eliminado vía Desktop Commander.
- [x] **i18n**: 32 pares nuevos es/en. **Test**: `testAiTextParsing` (9
      asserts) en `tests/critical.browser.ts`.

## Review — verificación

Sandbox y máquina real (npx/node directos, lección #37): tsc renderer
`--force` verde, tsc electron verde, lint 0 huellas, conformidad
**2.367 claves**, `run-critical-tests` **14/14 PASS**. E2E manual pendiente
de Luis (es literalmente el botón): descargar motor → pull del 9B → resumen/
personajes; luego el 35B. Nada descargado en su máquina sin que él lo pida.

## Notas para el futuro

- El zip del runtime no reanuda (v1); los pulls de modelos sí (Ollama).
- `settings.ai.local.*` y los códigos de error del main (`no-space:N`,
  `runtime-missing`, `model-missing`, `busy`, `cancelled`) están mapeados en
  `aiStore.localErrorText`.
- Ideas no pedidas: streaming de tokens, runtime embebido mac/linux, GGUF
  propios, enrutado por función (resumen→9b, consistencia→35b).
