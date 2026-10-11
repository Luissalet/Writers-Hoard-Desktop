# Implementación del editor avanzado de Writers

Luis autoriza implementar la mejor vía y exige que cualquier código tomado de Wordcraft sea una copia propia separada: código de Writers adaptado a nuestro entorno, sin enlace operativo, submódulo, dependencia Git, updater ni obligación de seguir el repositorio original. Los avisos de licencia y procedencia histórica se conservan.

Dirección: React/TypeScript para Writers e interacción del editor; núcleo Rust propio para documentos e intercambio, incorporando código útil del commit Wordcraft 6526b134befbf6933fd87a63bfea37a7828f29c4. No migrar toda la aplicación ni cambiar Electron como requisito.

## Trabajo paralelo

1. Tarea 348: núcleo documental propio en native/, crates adaptados y renombrados, assets y avisos, empaquetado reproducible y puente de producto. Importación/exportación, inspección, comandos y render/export PDF; no enlazar la app original. Resolver persistencia de binarios y partes originales. Tests de núcleo y DOCX y pruebas del servicio real.
2. Tarea 347: formato semántico y extensiones de editor, estilos, tablas, fuentes, tamaños, colores, alineación, espaciado y saltos, controles integrados con identidad actual ES/EN. Guardar/reabrir/exportar sin pérdidas. Mantener capítulos, notas, undo, versiones y funciones actuales.
3. Integración raíz: el núcleo común de herramientas expone edición y documentos por MCP y usa las mismas operaciones que la UI. Conectar importación/exportación y probar flujo completo. No tocar rutas reservadas por tarea 340 hasta coordinar con su dueño; ampliar primero módulos nuevos sin conflicto.
4. Revisión independiente: lector de código y pruebas en instancia privada, UI completa y MCP real, errores y recuperación, Unicode y grandes documentos; entrega congelada con revisión de envío correcta.
5. Integración y documentación: merge lock de Writers, HEAD comprobado justo antes, cambios aprobados en main sin push; README, plan y capacidades, manual y memoria actualizados. Conservar los datos reales y procesos de usuario.

## Criterios de éxito

- Una instalación construida de Writers utiliza su propio código documental sin descarga o acceso a Wordcraft; no submódulos ni remotos upstream para el código incorporado.
- Abrir DOCX, inspeccionar contenido y formato, editar desde UI y MCP, guardar, reabrir y exportar PDF. Corpus de tablas, imágenes, estilos, notas, comentarios y revisiones; documentar cualquier formato aún no editable.
- El formato añadido sobrevive sanitización, autoguardado, cambios de capítulo, reinicio y exportaciones. Documento único, assets completos y posiciones Unicode correctas.
- Funciones de documento expuestas por API/MCP y controles normales, sin script puntual como capacidad final.
- Checks pertinentes, compilación desktop, pruebas de núcleo Rust y flujos reales de UI/MCP pasan. No prometer paridad total ni velocidad superior sin comparación medida.

La licencia no obliga a mantener vínculo funcional con el upstream. Conservar autores/avisos de fuente y assets, sustituir marcas e identidad visual y mantener un inventario de procedencia por archivo.

Cuotas consultadas al iniciar: Codex en Ágora stale/unknown; cuenta de este chat comprobada anteriormente con 72% restante y se vuelve a consultar antes de delegar. Claude unknown y Cursor 0: no asignarles trabajo nuevo sin cuota confirmada. Se usarán auxiliares del propio chat, autorizados por AGENTS de Writers; los mensajes del Ágora no despiertan por sí solos otros chats.

## Estado de la primera entrega

347 revisión2 y348 revisión1 aprobadas e integradas. Editor rico y núcleo propio
listos; ver verification.md para los recorridos comprobados y los límites concretos.
Las fases siguientes del informe están registradas como353 (control de cambios y
propuestas ancladas) y354 (secciones, estilos y referencias editoriales vinculadas).
No se presentan como funciones ya implementadas.
