# Catálogo derivado de un paquete local antes de instalar (S05)

El autor de un paquete runtime propio de Writer puede declarar un `catalogue` opcional en `local-tool.runtime.json`. Por miembro, indica el namespace y un JSON local con `documentBacked`, `stateFields` y, si corresponde, un índice explícito. El módulo importa esa misma declaración; `pack --runtime` deriva de los datos las operaciones y los campos de índice, y los incluye en el hash del paquete. Las operaciones escritas a mano no entran en esta vista; un índice explícito prevalece. [Contrato de autoría](../../docs/local-tool-sdk.md#preview-derived-operations-before-installing-a-runtime-package).

`check --runtime`, el panel de paquetes y `wh_local_package_inspect` muestran ese catálogo antes de instalar, sin ejecutar la herramienta. El empaquetado compila el módulo; la derivación del catálogo lee la declaración sin cargarlo. Instalar sí prepara el código: coteja namespace, alcance de documento, operaciones derivadas e índice efectivo con el catálogo antes de guardar o registrar. Un desajuste rechaza la instalación sin publicar el paquete ni alterar el pin del proyecto. Instalar uno válido no lo fija automáticamente a un proyecto. Los paquetes anteriores sin declaración conservan su comportamiento. Source/1 sigue siendo el formato de autoría, no un paquete runtime ejecutable.

## Pruebas por corte

Source2639: `9d2552272707bd696a51807091680a28538fc04e`, trece rutas, corte final `82026312`; inventario `COMMIT-CUT2639-r1.json` (`ac9af481`). CAS 1 aprobada y Main por fast-forward, sin push (`f4bbe259`). Los recibos propios están en `Research/writer-parity-20261110/sdk-package-catalogue-source`. El Manual añadió 220 unidades UTF-16 y se releyó exacto (`a0e32c0d`).

| Corte | Qué acredita |
| --- | --- |
| Referencia 2638, CLI público 0.8.13 | `save --dry-run` en proyecto sintético y perfil sin sesión: seis campos de agente y tres de índice, EOF 0 y sin guardar. Son recuentos de campos, no de operaciones ejecutadas. No se autenticó, publicó ni editó un mundo. `sdk-package-catalogue/REPORT-r1.md`, recibo `eb8fcf1d`. |
| Brave r1 sobre candidato r2, `72b76ed7` | En el gestor normal, ocho operaciones y tres campos indexados visibles antes de instalar. El desajuste deja vacío el inventario; el paquete coincidente se instala sin pin automático. DOM y recibo sin errores de consola; no se tomó captura ni se repitió Brave sobre el commit final. |
| Formato, CLI y gates del corte final | Seis casos FORMAT PASS: bytes canónicos, identidad, BOM, sintaxis/hashes, rechazo de Source/1 como runtime y derivación CLI sin cargar la herramienta. `pack` y `check` exit 0 para ambos fixtures; el reempaquetado conservó cada byte. Quick y build finales exit 0; se conserva el Quick inicial fallido por el tipado que arrastró imports del renderer. |
| Native final, `1caeb04e` | Dos claves en perfil aislado: 20 llamadas MCP, 24 RPC y 20 respuestas IPC. Inspección por datos, rechazo por desajuste antes de guardar, instalación y pin explícito, y una operación derivada sobre un Source real. Se acreditan ese transporte y esa operación, no el montaje de un editor Source. Dos revocaciones 401 sin nuevo IPC, ambos EOF 0 y perfil retirado. |

El positivo cubre un catálogo optativo de **paquetes runtime propios** y su cotejo al instalar. No cubre importación de paquetes ajenos, equivalencia ABI, publicación, una sesión autenticada en el CLI de referencia ni paridad general. [Derivación anterior en el SDK compilado](verification-sdk-derived-agent2633.md).

## Medición 2318 a 50.000 unidades UTF-16

Se midió el SDK público real en memoria con el kit de autor normal, Node 22.19.0, base Main `c5d0917f` y oráculo exacto `5ad2811c`, sin perfilador. Cien gestos, 1.115 comprobaciones, 100 actualizaciones, 100 recibos y cinco réplicas creadas y destruidas; EOF 0 y sin escrituras de producto. P95: **1.549,4158 ms** del gesto, **0,8181 ms** de captura y **1.546,7038 ms** de aplicación. Son percentiles por fase, no sumandos. El coste dominante permanece en la aplicación.

La carga es de 50.000 **unidades UTF-16** con historial retenido. No mide respuesta interactiva del editor, Source/Dexie, IPC, MCP o IME, ni satisface el objetivo de 100 ms. El worktree de medición se retiró (`039a4745`); la tarea 2318 sigue abierta sólo en Research. Recibos: `Research/writer-parity-20261110/rich-perf-2318-next/MAIN50K-H2566-r1.md` (hilo 2566, mensaje 28829) y `main50k-base-r1/main50k-sdk-c5d0917-r1/SUMMARY.json` (manifiesto `e638b37d`). El ensayo plantea validar intervalos alcanzables del historial retenido con un oráculo estructural antes de medir otra optimización; no entrega ese cambio.
