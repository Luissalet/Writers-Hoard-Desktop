
---

# Los tres paquetes post-auditoría: anclajes, cosecha LEVE y guiones — 2026-08-21

Sesión sobre la lista que quedó viva tras cerrar el §7 de la auditoría del
16-08. Tres paquetes elegidos por Luis: AnchorAdapters para biography y
character-arc, la cosecha de LEVE entera, e importar Fountain/FDX + ciclado
de tipo con Tab en dialog-scene. **Nada commiteado**, 29 ficheros tocados
(26 editados + 3 nuevos).

## Plan ejecutado

- [x] LEVE 1 — `SprintTimer`: textarea de notas opcional; `WritingSession.notes`
      por fin tiene quien lo escriba (el centinela `notes === 'editor'` de
      `writingActivity.ts` queda documentado al lado).
- [x] LEVE 2 — `VideoSegment.speakerId` ELIMINADO del tipo (cero usos, sin
      índice, sin migración; los ZIP viejos importan igual).
- [x] LEVE 3 — `outline.wordTarget` por fin se LEE: chip `{escritas}/{objetivo}`
      en la fila de `BeatList` usando el `wordCount` del escrito enlazado (verde
      al llegar). `OutlineBeat.tags` ELIMINADO (nadie lo escribía ni leía).
- [x] LEVE 4 — selector de color por relación (`ColorPicker` + botón de volver
      al color del tipo); la vista de lista prefiere `r.color ?? cfg.color`.
- [x] LEVE 5 — `ArcBeat.status` editable: select en `BeatRow` calcado del de
      estado del arco (`ARC_STATUS_CONFIG`, cero claves nuevas).
- [x] LEVE 6a — `FactSource.entityId` por fin se escribe: `LinkSelect` de
      capturas del Scrapper en `FactEditor` (visible sólo con tipo Captura);
      la fuente muestra el título de la captura enlazada. `FactEditor` recibe
      `projectId` nuevo desde `BiographyView`.
- [x] LEVE 6b — el export narrativo de biografía usa `downloadTextFile` (el
      blob artesanal no revocaba su object URL).
- [x] LEVE 7 — pie de foto editable en `GalleryLightbox` (`gallery.notes` se
      buscaba y mostraba pero no había dónde escribirlo); el lightbox
      re-resuelve la imagen desde `images` para no quedarse congelado.
- [x] LEVE 8a — las conexiones del timeline por fin se EDITAN: `editConnection`
      cableado (existía sin llamador), menú contextual con etiqueta, estilo
      (continuo/discontinuo/punteado) y color — el dibujante ya sabía pintarlo
      todo.
- [x] LEVE 8b — renombrar línea temporal: `onEditTimeline` destructurado (llegaba
      y se ignoraba); clic en la etiqueta del carril abre modal de nombre +
      descripción.
- [x] LEVE 9 — `GoogleDocsPicker` se desmonta al cerrar (render condicional,
      patrón FactEditor/PanelEditor); ya no conserva búsqueda ni selección.
- [x] LEVE 10 — `assertBackupCoverage` ahora itera `db.tables` (el universo
      real) en vez de las tablas declaradas por motores: las 4 de project-tools
      quedan vigiladas y cualquier tabla futura sin respaldo salta. Lista
      explícita `DERIVED_CACHE_TABLES` (worldSnapshots, canonTiles,
      renderedTiles) para las cachés regenerables.
- [x] ANCLAJES — biography y character-arc con `AnchorAdapter` explícito
      (entity-only; los dos sondean sus dos tablas, chip localizado
      `annotations.chipLabel.*`, y navegación real: un fact lleva a su
      biografía, un beat a su arco). OJO: ya aparecían en el selector por el
      adaptador de RESPALDO (`registerFallbackAdapters`) — lo que faltaba era
      chip traducido, URL viva y la MITAD RECEPTORA: `useDeepLinkParam('bio')`
      en `BiographyEngine` y `useDeepLinkParam('arc')` en `CharacterArcEngine`
      (patrón render-adjust con guarda, como codex). Montado
      `<AnnotationSurface layout="stack">` en `BiographyView` y en `ArcEditor`.
- [x] IMPORTAR GUIONES — tres ficheros nuevos en dialog-scene:
      `importPersist.ts` (contratos + `importScript`: transacción con
      `bulkAdd`, APPEND-ONLY tras las escenas existentes, `#N#` ⇒
      `isLocked: true` porque el motor renumera en cada gesto, un `SceneCast`
      por nombre canónico —extensiones `(V.O.)` fuera de la identidad,
      `(CONT'D)` eliminado— y `characterId` del códice estampado en cast y
      bloques, que alimenta el Cockpit), `fountainImport.ts` (parser puro,
      inverso del exportador: título-page/boneyard/`===` fuera, sinopsis a
      descripción, secciones a nota, OMITTED, `#N#`, `>`/`TO:`, `[[notas]]`
      multilínea, `!`, `@`, cues con `^` dual y paréntesis inicial al campo,
      `*línea*` a acotación; pérdidas documentadas en cabecera: los slugs
      exportados vuelven como límite de escena) y `fdxImport.ts` (DOMParser
      XML sin dependencias; Shot→slug, Cast List→nota, dual por contenedor y
      por atributo best-effort, `Number`→número). Botón Importar en
      `SceneListView` FUERA de la guarda `scenes.length > 0`, detección por
      extensión + sniff `<FinalDraft`, prop nueva `onImported` ⇒
      `autoNumberScenes` + `refresh` sin timer.
- [x] TAB — ciclado de tipo de bloque en el editor: `dialog → action →
      stage-direction → transition → slug → note` (Shift+Tab inverso),
      saltando `dialog` si el bloque no tiene nombre (evita la cabecera vacía)
      y sin tocar los duales. Convive con el autocompletado por
      `e.defaultPrevented` (su listener nativo va antes); `flush()` del campo
      antes del cambio de tipo (cero teclas perdidas) y refocus por efecto en
      `[block.type]` — la instancia sobrevive (key = block.id), sólo cambia el
      textarea.
- [x] i18n — 18 pares nuevos en en/es: `dialogScene.import.*` (8),
      `annotations.chipLabel.{biography,character-arc}`,
      `timeline.{connectionLabel,renameTimeline,style.*}`,
      `relationships.{color,colorReset}`, `gallery.imageNotes`.
- [x] Test — `testScriptImportRoundTrip` en `tests/critical.browser.ts`:
      helpers de cue, round-trip `buildFountain → parseFountain` (heading+
      número, paréntesis, dual, acotación, transición, nota, OMITTED, slug
      como límite, descripción como acción, `(V.O.)`), FDX inline (runs de
      texto, fusión de Dialogue consecutivos, CONT'D, Shot/Transition) y
      persistencia real (`importScript`: recuentos, candado del número,
      estampado del códice) con limpieza.

## Review — verificación

En la máquina real (Desktop Commander, shell Windows): `tsc -b --noEmit`
(renderer, 12s, verde con --verbose enseñando la build), tsc de Electron
verde, `check-lint.mjs` verde con 0 huellas, `check-conformance.mjs` verde
(21 motores, 41 tablas, **2.335 claves**), y `npx electron
scripts/run-critical-tests.cjs` **13/13 PASS** incluido el test nuevo.
También todo verde antes en el sandbox (npm ci --ignore-scripts).

**Aviso de herramienta**: en esta máquina, `npm run X 2>&1 | Out-String` en
PowerShell devuelve exit 1 falso y se traga la salida del hijo — los portones
hay que lanzarlos con `npx`/`node` directos.

## Lo que queda (después de esto)

- `AiToolbar.tsx`: 6 cadenas en español fijo (Luis lo dejó fuera a propósito).
- Sin UI aún: `Payoff` ya tiene sus tres selectores… (cerrado el 16-08); nada
  más pendiente de la auditoría.
- Ideas apuntadas, no pedidas: modo reemplazo/merge en el import, export FDX,
  crear entradas de códice para hablantes desconocidos al importar, ciclado
  Tab dentro de duales.
