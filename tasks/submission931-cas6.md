#931 CAS6 — progreso físico sin repetir conexiones cerradas

Corrección mínima sobre CAS5 fa718dd365b023a0a7a0ef700ce88100c90a6e39. Raíz fijó revisión5 antes de probar y registró CHANGES5 en REVIEW931-CAS5-PHYSICAL-PROGRESS.md. El defecto era repetir un cierre completo al cerrar después el pool; no se observó falsoOFF en ese testigo. Informe, writer931-physical-progress-review.py y writer931-cas5-physical-progress.log externos intactos. Informe/recibos versionados de CAS5 se conservan como evidencia histórica, sin reinterpretarlos.

## Corrección y prueba causal

close_client conserva junto a cada conexión su pool propietario. Tras await connection.aclose exitoso, retira esa identidad de pool._connections bajo _optional_thread_lock; sólo entonces avanza el checkpoint. Si falla, no retira la conexión ni avanza. Así transport.aclose posterior no repite un cierre físico ya completado. Se conservan los callbacks/lock de Shutdown, shield/join, rechazoON, app/worker retenidos y cierres por pasos existentes; no SDK ni schemas cambiados.

La regresión propia anterior retornaba antes de contar si el stream ya estaba cerrado, ocultando repetición. Ahora cuenta TODAS las invocaciones y usa dos conexiones HTTPcore/HTTP11 reales: una buena y otra con dos fallos. Exige good1/bad3 tras dos errores, tercer éxito y cierre duplicado. tests/test_publishing_shutdown.py:5PASS5.28s, tasks/publishing931-cas6-physical-close.xml; incluye las cuatro fábricas reales y cancelación retenida durante el tercer cierre del transporte real del twin SDK. Sin modelos/red ni datos personales.

## Paquete final CAS6

Frozen reconstruido con node scripts/build-publishing-runtime.mjs --worker-only, log frozen-build-cas6.log. Sin Rust, sin cambios de los cuatro binarios/build.json previos. Ejecutable32652347bytes SHAc9e7623eae121b2758e077fe435ab6cdd9394815ceb5cc74a291614052c054ac. Árbol completo8476archivos/582163836bytes, inventario canónico SHAc7d56903ed979aa28cbba34de098be3694eb7f0ea01645d155cadc281a69148e. Inventario completo externo cas6-frozen-inventory.json SHAdb43358affa36b9785005a44359ecd0169995d3d85252436170a83c80a7a05da.

Testigo independiente ORIGINAL e intacto, ejecutado con -c por ese frozen (sin fuentes del checkout, conexiones externas ni modelos): good1/bad3, all_closedTrue/pool_emptyTrue, exit0. Recibo cas6-frozen-physical-progress.log SHAc5d95e9c7a421359f8cf6e9bd538b16fc49e0e86fabe6752f3170b5851314cd1. La prueba propia además exige que el cierre terminal duplicado no repita ninguna invocación.

PublishingService de producción contra ese frozen:4PASS, cuatro módulos/automatismosOFF y ningún worker al consultar status; ON/MCP/OFF y salida de cadaPID. Editorial abre sesión Rust persistente, creaA4/inspect y une el cierre real. Recibo cas6-frozen-service/receipt.json SHA039b15f584d20d3791384a26692b2aa724d0439b639918e65ef6fe2515509b9c. Los6casos fuente de worker retenido/cierre global/EOF,14del área, transporte, typechecks y Vite de CAS5 permanecen históricos: no se repiten suites generales por un delta del helper sin cambios de servicio/UI. Los5focales finales y4frozen sí prueban esta versión. Inventario compacto versionado tasks/publishing931-cas6-package.json; QA externa D:/LocalAI/research-inbox/fusion-candidates-wave3/writer931-close-cas5.

## Límites

Listo para CAS6 exacta independiente, sin integrar ni activar. Sin datos/perfiles/env/tokens reales, apps instaladas, fuentes antiguas, SDK, Hub/Faustus/modelos/GPU/browser, migración/push/publicación. Ninguna limpieza rechazada se repite; carpetas ignoradas y recibos históricos permanecen. No afirma todos los fallos/formatos, CUA/Electron instalado, instalador completo,938real ni PDF/X/PDF/UA. Raíz controla esas verificaciones, migración934 y activación. Cuota4% medida fresca/secundariaUNKNOWN al comenzar; se consulta de nuevo antes de solicitar revisión.
