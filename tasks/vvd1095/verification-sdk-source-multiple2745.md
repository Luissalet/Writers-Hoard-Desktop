# Añadir varios campos a un documento Source

En la definición nueva, usa `sourceAdditive: { from, fields: { habitat: 'Coast', threat: 4, traits: [], stats: {} } }` con los descriptores correspondientes. `from` identifica el codec y el esquema exactos del predecesor. Los campos existentes conservan sus descriptores. Esta declaración admite escalares, mapas vacíos y listas vacías con IDs estables. [SDK local](../../docs/local-tool-sdk.md#add-several-fields-in-one-source-release)

Seleccionar la versión y abrir el documento muestra los valores por defecto sin guardarlos. La primera tanda efectiva conserva el origen y guarda una sola revisión. Deshacer quita las escrituras propias y vuelve a mostrar los valores por defecto. Usa las acciones del SDK o `wh_local_tool_state_apply` y el Deshacer habitual. Las adiciones sucesivas sobre un documento ya promovido y las migraciones no aditivas siguen abiertas.

## Verificación

- Brave ejecutó el SDK oficial de VVD sobre un documento antiguo sintético. La versión anterior escribió un nombre. La nueva leyó dos escalares, una lista vacía y un mapa vacío con el mismo esquema y cero eventos de actualización en la lectura. Después escribió sólo un escalar. [Demo oficial](https://docs.vvd.world/workshop/guides/storing-data#edit-the-shape-and-watch-it-change)
- Writer rechazó la declaración múltiple antes del cambio. Brave r2 pasó 20 comprobaciones con seis campos, incluidas escrituras dispersas, un Deshacer, dos autores, entrega parcial de dos listas y reapertura. Pasaron además las regresiones de escalar, mapa, lista, entrega parcial e historial físico del formato anterior.
- Puente real Native. Dos claves y 22 llamadas MCP verificaron lectura pasiva, promoción, Deshacer, ámbito de era y Base intacta. Dos revocaciones dieron 401 sin IPC, las sesiones terminaron con EOF 0 y quedaron 89 tablas privadas vacías. El perfil y los bundles de prueba se retiraron. Quick y build r2 finalizaron con EOF 0.

La revisión 1 de #2745 aprobó `f755eba9b2d8c6f492659dab98f93db6e95d044e`, integrado por fast-forward. El manual de Google recoge la transición. Recibos en `Research/writer-parity-20261110/sdk-additive-multiple`.
