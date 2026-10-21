# 5e — R01/R02: clase/nivel y conjuros preparados (1041)

Estado: **PLAN PROPUESTO, pendiente de autorización de raíz. No producto implementado.** Autor posterior: authoring_finish_final; revisión independiente posterior por otro agente. WT aislado writer-worldcraft1041. Lock del frente tomado por raíz. Cuota aportada16% primary, medida22:52Z, stale=false; secundariaUNKNOWN. No medición propia.

## Problema, evidencia y criterio de cierre

La referencia actual0.1.11 sí calcula clase/nivel, espacios y conjuración. No se puede registrar como una simple hoja manual. Evidencia proporcionada por raíz e inspeccionada (AX y tres PNG individuales): carpeta `C:/Users/luism/Documents/Codex/2026-10-20/fun-with-qwen-image-2-x20/outputs/vvd-reference/`, archivos `5e-current-fullsheet`, `5e-wizard-level6-prepared`, `5e-warlock-level5` (`.ax.txt/.png`). La referencia remota es clásica2014/SRD5.1; no se ejerció aquí vvd2 0.1.2. No se creó ni guardó nada remoto.

Contratos observados: Wizard5, CON10 e INT18 → HPmax22, PB3, spellDC15, attack+7, slots4/3/2; Arcana competente+7; pulsar marca3 de espacios marca1–3; escribir Shield permite marcar Prepared. HPmax30/current18 manuales sobreviven Wizard6, mientras slots pasan4/3/3. Cambiar a Warlock5 mantieneHP30/18 y Shield preparado; CHA, DC11, attack+3 y dos espacios de nivel3, con niveles1/2 vacíos. No se comprobó recuperación de usos ocultos al volver de clase; no inferir un reset de la referencia.

En nuestro producto existe `createSheet('5e-character')` en types.ts, no una función separada createSheet5e: recursos hp/hitDice/slot1..9, traits y skills genéricos, entrenamiento0/1/2 y derivados PB/DC/attack. Faltan un perfil de clase/nivel, maxima de clase y filas de hechizo con Prepared. Se añadirá dentro de character-sheets, usando sus drafts, Save/CAS, receipts y proyección comunes.

Éxito: reproducir esos escenarios por servicio, UI normal y MCP nativo; conservar valores manuales/recursos jugados, legacy y otras fichas; mismo resultado en Base/era y exportaciones. No claim de catálogo de hechizos, level-up completo, feats, subclases o todos los efectos de clase.

## Fuentes primarias y versión explícita

1. [SRD5.1 oficial CC BY4.0](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf),403p. Copia QA fuera del producto: `work/five-e-primary/SRD_CC_v5.1.pdf`, SHA256 **2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0**. Extracción local de primeras120p para comprobar tablas, sin empaquetarla en la app. P1 licencia; p3–7 razas; clases/tables en los rangos de abajo; p56 avance/PB; Wizard52–53; Warlock46–47.
2. [Basic Rules2014, Beyond1stLevel](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/step-by-step-characters#Beyond1stLevel): mínimo1 por aumento de HP y CON retroactivo. El PDF SRD5.1 conserva texto anterior sin ese inciso: documentar esta precisión2014 en FIVE-E-SOURCES.md, no atribuir silenciosamente la frase al PDF. Sólo mecánica, sin copiar prosa Basic Rules.
3. [Nota oficial sobre SRD5.2/2014/2024](https://www.dndbeyond.com/posts/1949-you-can-now-publish-your-own-creations-using-the):5.1 corresponde2014;5.2/5.2.1 corresponde2024, hoy rotulado5.5e. No mezclar tablas por compartir el nombre5e.
4. [Publicación oficial CC](https://www.dndbeyond.com/posts/1439-ogl-1-0a-creative-commons) y [licencia CC BY4.0](https://creativecommons.org/licenses/by/4.0/).

Tabla a implementar: hechos/números y referencias, sin párrafos de clase, imágenes, logo ni papel oficial.

| Clase | HD | Tipo de espacios | Aptitud | SRD5.1 p. |
|---|---:|---|---|---|
| Barbarian |d12|ninguno|—|8–10|
| Bard |d8|caster completo|CHA|11–14|
| Cleric |d8|caster completo|WIS|15–18|
| Druid |d8|caster completo|WIS|19–23|
| Fighter |d10|ninguno en perfil base|—|24–25|
| Monk |d8|ninguno|—|26–29|
| Paladin |d10|medio, desde2|CHA|30–34|
| Ranger |d10|medio, desde2|WIS|35–38|
| Rogue |d8|ninguno en perfil base|—|39–41|
| Sorcerer |d6|caster completo|CHA|42–45|
| Warlock |d8|Pact Magic separado|CHA|46–51|
| Wizard |d6|caster completo|INT|52–55|

Perfil propio visible **5e (2014) · SRD5.1**, opcional, sólo `5e-character`. El enlace actual5.2.1 del preset no demuestra que las fichas antiguas usaran2014: no migrarlas ni activar reglas al abrir/importar/leer. El footer activo mostrará la fuente de su perfil; stat-block y sus fuentes5.2.1 quedan intactos.

Para el cálculo fijo de HP: dado completo inicial+CON, y valor fijo de clase+CON por nivel posterior, mínimo1 por incremento; 1..20, entero. No simular tiradas de HP ni aplicar ASI; el HP manual soporta esas decisiones. PB existente y su override siguen vigentes. Slots por tablas explícitas de clase, no por redondeo de una fórmula aproximada. Warlock no recibe la tabla full-caster; Mystic Arcanum se mantiene como anotación/fila manual, no como slot normal6–9. Fighter/Rogue sin subclase caster no obtienen slots automáticos. No multiclass automático.

Attribution futura en FIVE-E-SOURCES.md y distribuida por la vía de licencias existente: usar el statement requerido en p1 del PDF, con enlaces originales y CC; señalar adaptación a tablas/cálculos/UI propios. No copiar la hoja impresa observada ni su logotipo. Nueve sugerencias de especie/raza2014 (Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling) son sólo datalist editable sobre details.species; no modifican ability scores.

## Datos y tipos propuestos (aún no código)

Se mantiene el JSON de ficha v1, con dos extensiones opcionales. IDs estables, sin overlay ni almacenamiento paralelo:

```ts
type FiveEClassId = 'barbarian'|'bard'|'cleric'|'druid'|'fighter'|'monk'
  |'paladin'|'ranger'|'rogue'|'sorcerer'|'warlock'|'wizard';
type FiveEAbilityId = 'strength'|'dexterity'|'constitution'
  |'intelligence'|'wisdom'|'charisma';
type FiveEAutoField = 'hpMax'|'hitDiceMax'|'castingAbility'
  |'slot1Max'|'slot2Max'|'slot3Max'|'slot4Max'|'slot5Max'
  |'slot6Max'|'slot7Max'|'slot8Max'|'slot9Max';
interface FiveEState {
  version: 1;
  ruleset: 'srd-5.1-2014';
  classId: FiveEClassId;
  auto: FiveEAutoField[]; // campos vinculados; valor manual vive en recurso actual
  castingAbilityId?: FiveEAbilityId; // ID, no posición mutable de traits
  spellSaveDcOverride?: number;
  spellAttackOverride?: number;
}
interface FiveESpellRow {
  version: 1;
  level: number; // entero0..9
  prepared: boolean;
}
// CharacterSheet.fiveE?: FiveEState;
// SheetRow.fiveESpell?: FiveESpellRow; resto de la fila actual sin cambio.
```

`numbers.level`, traits, resources y rows siguen siendo los datos actuales; no duplicar nivel ni HP en FiveEState. La lista auto marca vinculación, no otro valor guardado. Editar manualmente un máximo en Recursos lo desvincula; Use calculation vuelve a vincularlo explícitamente. PB usa numbers.proficiencyOverride existente. La aptitud activa se resuelve por ID estable; borrar/reordenar traits no debe seleccionar otra accidentalmente. Un ID ausente produce derivado no disponible y aviso, no un0 inventado.

Los spell rows reutilizan name/detail/expression/quantity y su ID. Level/prepared tienen semántica propia, sin parsear section por idioma. Las filas antiguas Spells/Conjuros siguen exactas; el usuario puede convertirlas explícitamente. Nombres/descripciones/expresiones libres, sin catálogo remoto. Cantrips nivel0 sin espacio. Marcas de preparado son notas manuales: no validar una biblioteca o selección de clase completa ni borrar una marca al cambiar de clase. Conocidos/preparados y excepciones se resuelven en la mesa.

Validación nueva sólo de campos presentes: preset, versión, reglas, clase, campos auto únicos conocidos, números finitos acotados y metadata row entera/boolean. Mantener todos los límites actuales y legacy sin campos nuevos válido.

## Servicios, automatización y conservación

Hoja pura nueva `fiveE.ts`: tabla de hechos/progresiones; `fiveEDerived`, `fiveEClassPreview`, `applyFiveEClass`, `reconcileFiveESheet`, `setFiveEResource` y helpers de filas/preparación. No nuevo motor de reglas ni sistema de callbacks. Reconciliación compuesta con CoC en los puntos normales ya existentes, devolviendo misma ficha para otros presets o ausencia de perfil.

Activación/clase/nivel por preview y **Apply selected fields**. Mostrar cambios antes→después; no escribir hasta aplicar. Sólo se reconoce classId seleccionado explícitamente, no se adivina de texto libre. Cambiar el label de clase registrado es un campo explícito del preview; las denominaciones propias se conservan si no se selecciona. No elegir competencias, armas, equipo o subclase por el usuario.

Campos auto siguen cambios posteriores de nivel/CON sólo mientras continúan vinculados. Una edición manual de max o aptitud desvincula ese campo y conserva el dato. Si un nuevo cálculo exigiría descartar current/uso por reducción de capacidad, conservar el recurso y desvincularlo; mostrar propuesta para aplicar/clamp explícito. No sanar, descansar, vaciar ni restaurar contadores al cambiar clase/nivel. Recursos eliminados/renombrados/marcados se conservan; no recrear por coincidencia de label. Recrear un recurso ausente sólo si se selecciona una propuesta que lo indica.

HP current: conservar valor jugado; en una activación explícita inicial con HP lleno, el preview puede ofrecer llenar al máximo nuevo, mostrando ambos valores. Fuera de esa elección, HP30/18 sigue30/18 incluso al cambiar nivel/clase. HP manual0 también es manual.

Slots reutilizan slot1..9. En un recurso available (`marked:false`), usado=max-current; en marked, usado=current. Play muestra **used/available** con semántica explícita; pulsar marca3 fija3 usados y marca1–3, sin cambiar marked. Al crecer capacidad, preservar usos; al reducir por debajo de usos, requiere selección explícita del clamp. Warlock identifica Pact Magic y nivel de slot aunque use el recurso slotN actual; niveles inactivos no se destruyen silenciosamente, y sus valores manuales/jugados están protegidos en preview. Reset/rest no se ejecuta por cambios de clase; cualquier reset será acción explícita individual de recurso, no una nueva adjudicación de descanso.

Consentimiento de UI ligado a los valores mostrados antes/después (incluye current/max/marked cuando afecta recurso), no a un nombre de campo para siempre. Revalidar contra `current` dentro de update y descartar selección stale; adoptar la lección DH sin editar su leaf. MCP exige revision actual y writer repite CAS; aplica sólo campos explícitos. Un mismo Apply sin cambios no genera revision/receipt nuevo.

## UI y seams de escritura propuestos

- `FiveEPlayPanel.tsx` nuevo, componentes Field/NumberField/button/input incumbentes; perfil/clase/nivel, resumen HP/PB/DC/attack y espacios usados. Añadir Play sólo para5e-character en SheetEditor; demás pestañas y legacy disponibles. Sin papel oficial ni tema ajeno; charcoal/gold y soporte EN/ES1440/640.
- StatsPanel conserva abilities, skill training0/1/2, bonos, tiradas y PB override; deriva la aptitud por ID cuando el perfil2014 está activo. Arcana competente con INT18/PB3 debe mostrar+7. No duplicar todo Stats en Play.
- RowsPanel reutilizado para filas; añadir modo/controles de hechizo (level/prepared y Add spell). Mismo ID/draft en Play/Rows, nombre manual Shield y marca preparada persistente. Nunca se recodifica quantity como preparado.
- ResourcePanel conserva edición completa. Su cambio manual se detecta en reconciliación, sin modificar el leaf DH ni crear otra política de guardado.
- `CharacterSheetsEngine.tsx` y `operations.ts`: componer resolve/reconcile5e en los puntos de draft/save ya usados, incluidos callbacks era. Se mantiene SheetConflict, saveSheet, saveRevisionedEraMetadata y audit receipt.
- `bridge.ts`/`bridgeManifest.ts` del engine: `wh_sheet_5e_preview` (read-only, revision/changes/derived/source) y `wh_sheet_5e_action` (configure selected fields, recurso, upsert spell/prepare, use-calculation, override/reset casting). Wh_sheet_get añade derived.fiveE; update/import/export conservan estado por vía normal. Native headless llama al mismo servicio.
- `types.ts` opcionales/validación; `paper.ts` añade resumen2014 y level/prepared sólo si hay perfil/metadata, escapando texto y sin alterar SVG legacy sin nuevos campos. SVG completo común alimenta Reader/wiki/LibraryPNG. Conservar ink/strokes exactamente; activar perfil puede mover texto bajo coordenadas existentes y se explicará en preview.
- `FIVE-E-SOURCES.md`, README y tests nuevos. Posible ajuste mínimo de copy/locales del engine. No editar DaggerheartPlayPanel/daggerheart.ts/statBlockPaper/statBlock.ts.

**Costuras raíz fuera de ownership:** sólo si hacen falta, raíz añadirá wh_sheet_5e_action al allowlist de receipts/audit Undo y verificará manifest público/native. No editar desde este frente metadata global, operations global, manifest/index/undo global, Reader/wiki ni documentImage; su uso se comprueba por los caminos comunes. El render común sheetPaper ya es el seam de character-sheets y no necesita un exportador nuevo. Acordar handoff antes de tocar una dependencia compartida.

## Verificación a construir tras autorización

1. Tablas/servicio:12clases × niveles1/2/5/6/9/17/20, todas las filas de slots verificadas con SRD; PB límites; Paladin/Ranger1 sin slots; Warlock5 dos slots3 y no fullcaster; no-casters0. HP Wizard5 CON10=22; INT18/DC15/attack7; Arcana training1→7,2→10. Aptitud por ID tras reorder y missing. Finitos/NaN/version/preset/IDs/level0,21,fracción rechazan sin mutar.
2. Manual/consent: HP30/18 alWizard6 yWarlock5; HP0; max/label/marked propios; usos de slots no se resetean, clamp sólo selección explícita; deleted resource no reaparece. Preview sin writes; editar HP/recurso entre preview y Apply invalida esa selección incluso con callback delayed. Guardar/reabrir mantiene auto/unlink. Legacy sin state/rowmeta byteexacto,5e-stat-block/DH/CoC intactos.
3. Spells: nombre Shield, level1 y preparedtrue en UI y MCP; cambiar clase conserva fila/marca; edición/eliminación porID; nombre duplicado no comparte checkbox; HTML/Unicode texto escapado; section traducida o custom no convierte filas. JSON roundtrip y límites500rows.
4. Store: Base e inherited/ownera; expectedrevision stale; misma acción no-op; normal MCP receipt Undo/one-use/context/newer edit; rollback outer real y retry, restore/history/Archive; Base untouched al cambiar era. No simular receiptUndo mediante overwrite.
5. Native externo stdio→HTTP→executor→IPC→DB; herramientas registradas preview/action/get, no parapeto de helpers. UI realCSS/input1440/640 EN/ES: crear/activarWizard5, INT18, Arcana entrenada, marcar3, spellprepared, HPmanual→lv6→Warlock5, Save y reabrir; conflictos/draft preservados. Separar Ctrl+A/text y confirmar valor antes de Save.
6. Portabilidad: fichaJSON/projectJSON/ZIP/clone + era/retained history; metadata opcional, IDs y opaque fields/ink exactos. Reader/wiki y PNG reales desde vías comunes incluyen nivel/prepared/recursos del perfil activo, sin escribir DB; controles legacy papel permanecen iguales sin optin. Inspección visual acotada a estas pantallas/exports, no34/map polish.
7. Regresiones pertinentes character-sheets existentes (CoC, DH, statblock, ink), renderer typecheck y lint de hojas editadas. Congelar sources/fixtures/provenance y fallos originales; solicitar revisión independiente antes de integrar. No autorreview.

## Entrega del plan

Baseline de fuentes leídas en `work/five-e-primary/product-baseline-before-plan.json`; evidencia primaria y referencia en `work/five-e-primary/source-provenance.json`. Sólo este plan y esos artefactos QA se escriben en esta fase. No aprobación inferida por silencio; no comenzar producto hasta autorización de raíz sobre este plan.

## Addendum de implementación autorizada

Raíz autorizó el plan SHA3a94624c332c4ba10acdbc61fe884dd8167d0c4df45c3fc32c8ca2efc6c391db y, después, la extensión mínima `FiveEState.applied:Partial<Record<FiveEAutoField,number|string>>`. Este ledger contiene sólo la última salida automática de campos conocidos y tipos validados. Permite distinguir un draft ya reconciliado que pasa después por Save de una edición manual del máximo en el mismo payload que nivel/CON. No duplica nivel, CON ni HP actual; no migra fichas antiguas. Los casos de máximo manual igual al nuevo cálculo y doble reconciliación tienen oráculos explícitos.

Implementados el servicio puro, Play integrado, filas preparadas, export completo y dos herramientas normales del engine. Raíz añadió sólo la allowlist global de Undo. No se editaron hojas Daggerheart/statblock ni Reader/wiki/global metadata desde este frente. El paquete final `.impeccable/review/five-e1041/` distingue fuentes propias congeladas, dependencias observadas, capturas nativas EN, suplemento DOM ES y fallos previos conservados. La verificación de autor no sustituye la revisión independiente asignada por raíz.
