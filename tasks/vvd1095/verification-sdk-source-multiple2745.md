# Añadir varios campos a un documento Source

En la definición nueva, usa `sourceAdditive: { from, fields: { habitat: 'Coast', threat: 4, traits: [], stats: {} } }` con los descriptores correspondientes. `from` identifica el codec y el esquema exactos del predecesor. Los campos existentes conservan sus descriptores. Esta declaración admite escalares, mapas vacíos y listas vacías con IDs estables. [SDK local](../../docs/local-tool-sdk.md#add-several-fields-in-one-source-release)

Seleccionar la versión y abrir el documento muestra los valores por defecto sin guardarlos. La primera tanda efectiva conserva el origen y guarda una sola revisión. Deshacer quita las escrituras propias y vuelve a mostrar los valores por defecto. Usa las acciones del SDK o `wh_local_tool_state_apply` y el Deshacer habitual. La sección inferior documenta las adiciones sucesivas. Las migraciones no aditivas siguen abiertas.

## Verificación

- Brave ejecutó el SDK oficial de VVD sobre un documento antiguo sintético. La versión anterior escribió un nombre. La nueva leyó dos escalares, una lista vacía y un mapa vacío con el mismo esquema y cero eventos de actualización en la lectura. Después escribió sólo un escalar. [Demo oficial](https://docs.vvd.world/workshop/guides/storing-data#edit-the-shape-and-watch-it-change)
- Writer rechazó la declaración múltiple antes del cambio. Brave r2 pasó 20 comprobaciones con seis campos, incluidas escrituras dispersas, un Deshacer, dos autores, entrega parcial de dos listas y reapertura. Pasaron además las regresiones de escalar, mapa, lista, entrega parcial e historial físico del formato anterior.
- Puente real Native. Dos claves y 22 llamadas MCP verificaron lectura pasiva, promoción, Deshacer, ámbito de era y Base intacta. Dos revocaciones dieron 401 sin IPC, las sesiones terminaron con EOF 0 y quedaron 89 tablas privadas vacías. El perfil y los bundles de prueba se retiraron. Quick y build r2 finalizaron con EOF 0.

La revisión 1 de #2745 aprobó `f755eba9b2d8c6f492659dab98f93db6e95d044e`, integrado por fast-forward. El manual de Google recoge la transición. Recibos en `Research/writer-parity-20261110/sdk-additive-multiple`.

## Encadenar ampliaciones desde otra versión aditiva

La versión V3 declara el predecesor exacto V2 en `from`. Para abrir directamente los documentos de V1, incluye V1 en `ancestors`. Cada identidad contiene `namespace`, `codec`, `validationId` y `schemaEpoch`. Declara sólo los campos nuevos en `fields` y conserva los descriptores de los anteriores. El nuevo codec proyecta los defaults de ambas etapas.

La lectura y una operación sin cambios dejan intacto el checkpoint de V1 o V2. La primera edición de V3 conserva el origen y los cambios de V2. Registra las fronteras necesarias junto a la escritura en una sola revisión. Deshacer conserva los cambios anteriores y recupera la ausencia de los campos recién escritos. Pin comprueba el historial retenido. El formato no autoriza cambios de tipo ni migraciones no aditivas.

El SDK oficial de VVD en Brave probó V1→V3 y V1→V2→V3, sin eventos de actualización al leer. Writer reprodujo el límite anterior y pasó 29 comprobaciones de la referencia y 22 de listas en dos etapas. Probó ausencia de escritura, pin inválido, frío, Deshacer y entregas parciales en ambos órdenes. Siete regresiones incluyeron historial físico y copias. Native r3 pasó 31 llamadas MCP con dos claves. Quick y Build r3 EOF 0.

La revisión 1 de #2777 aprobó `6d298436f0f1bd579042f08f1e3620cde9c1a49d`, integrado por fast-forward. El manual de Google describe ambas rutas. Recibos en Research/writer-parity-20261110/sdk-additive-successive.

## Leer los campos de una etapa anterior

Con V3 activa, `convergence.readAs(identityHash)` devuelve los campos acreditados de V1 o V2 a partir del dato actual. `wh_local_tool_read` admite el mismo `readAs` con `documentId`. Para la etapa inmediatamente anterior, consulta `fromHash` del codec que muestra `wh_local_tool_describe`. Los campos de V3 quedan fuera de la vista anterior y sus ediciones de campos compartidos siguen visibles.

La respuesta incluye las dos identidades, el ámbito, un indicador de conflicto y el dato admitido. La proyección no cambia la versión seleccionada, los bytes ni el historial. El escritor usa la lectura normal del estado activo.

Brave RED confirmó que faltaba el método. Brave GREEN pasó 46 comprobaciones de referencia y 36 de dos listas. El caso de conflicto devuelve el dato admitido. También pasaron las regresiones de ampliación múltiple, entregas parciales y archivos. Native r3 pasó 39 llamadas MCP con dos claves, incluido el ámbito heredado de una era. Quick y Build r3 EOF 0. El SDK de navegador y el host en memoria rechazan estados que cumplen el codec pero incumplen el validador activo. Las copias mantienen la validación portátil. La revisión 1 de #2839 aprobó `7ff7d4a0e50fecc7b8faaea55e2604ba551a5cd1`, integrado por fast-forward. El manual de Google describe esta lectura.
