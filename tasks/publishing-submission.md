# Entrega de código Writer — tarea 931

Base pública Writer a4bbf79; fuentes públicas Borges 10db1fb y Gutenberg ca8ee4c. Worktree aislado `D:/LocalAI/worktrees/writer-fisiones931`, rama `codex/fisiones-writer931`. El commit se facilita en el envío del Ágora.

Writer incorpora los paquetes completos de biblioteca, Links, Kafka/PDF y Gutenberg/Rust/editor como fuentes propias con licencias y procedencia (1306 registros de origen). Cuatro módulos apagados inicialmente; worker stdio privado y ASGI en memoria bajo demanda. Catálogo sin motores y automatismos separados. Vistas completas dentro de Writer, rutas locales que preservan HashRouter y tema común. No hay iframe, lanzador ni dependencia operativa de las apps/repos anteriores. Se conserva ficción/Scheherazade y su perfil.

Se conservan 394 herramientas nativas con esquemas y anotaciones exactos; el subsistema suma 401 con controles, búsqueda y vínculos persistentes entre proyectos Writer, objetos y resultados. La UI, API y MCP usan los mismos handlers. Se preservan app_id/copilot-space-id y los identificadores de los motores.

Evidencia terminada: cinco tests Python API/worker PASS (10.07s); runner MCP PASS para 401 esquemas/anotaciones, cuatro ciclos ON/OFF, vínculos API/MCP, multipart/binario/Range y navegación acotada. verify:quick PASS (typechecks renderer/Electron, lint sin fingerprints de baseline, conformance 27 motores/61 tablas/5440 claves/0 warnings). Bundles renderer (3413 módulos) y Electron PASS. Sin cambios posteriores de producto tras estas comprobaciones; no se repiten suites por el cierre documental.

El índice contiene 1358 archivos y excluye datos, .env, venv, node_modules, target, runtime y ejecutables. La comprobación de espacios del código anfitrión pasa; la comprobación completa señala espacios históricos en fuentes incorporadas (licencias y ejemplos PDF incluidos), conservados sin normalización. El plan previo de tasks/todo.md permanece tras el nuevo bloque de la tarea.

El runner usa stdio MCP real, un peer HTTP privado de prueba, createToolExecutor y PublishingService reales, worker y ASGI nativos con almacenes temporales. No acredita el arranque del listener Electron principal, una instalación real, interacción visual ni los binarios Rust/PyInstaller. La raíz debe realizar CUA, empaquetado/QA nativo, revisión independiente, instalación y migración antes de aceptar/activar. La tarea no se marca terminada ni se integra/publica aquí.

Inventario de datos/binarios y orden de traslado: `publishing/MIGRATION.json`. Incluye árboles anidados Links/Kafka antes del resto de biblioteca, rutas absolutas a remapear, WAL/SHM, tokens, perfiles/IDs y candidatos secretos no leídos. Ningún dato real, .env, perfil, binario ignorado, instalación, app, Hub o modelo fue trasladado, activado o modificado. Origen Writer 5174 e IndexedDB se conservan.

Documentación EN/ES: `docs/PUBLISHING.md`, README.md y README.es.md. Recibos: `tasks/publishing-verification.json` y `tasks/restart-integrity.json` (dos fuentes con NUL tras reinicio, reparadas y verificadas). La venv sintética accidental `publishing/links_native/publishing/.venv` permanece ignorada: su limpieza recursiva fue rechazada por revisión automática y no se reintentó; se inventaría hasta retirar el worktree.
