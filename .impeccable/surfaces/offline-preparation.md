---
version: 1
slug: offline-preparation
primary_target: src/components/project/ProjectHomeTools.tsx
related_targets: ["src/components/common/GlobalSearchBody.tsx", "src/components/project/workspace/library/LibraryBookmarkMenu.tsx", "src/components/project/workspace/library/WorkspaceLibrary.tsx", "src/services/workspaceAppearance/WorkspaceAppearance.tsx", "src/services/workspaceAppearance/WorkspaceDecoration.tsx", "src/engines/codex/WikiDocumentSelection.tsx", "src/engines/codex/WikiLayoutEditor.tsx", "src/engines/fiction/native/pages/SessionsPage.tsx", "src/engines/fiction/native/pages/SessionDetailsForm.tsx"]
---

# Preparación local de Writer1095

## Mode

Operate en el escritorio Electron existente; Read en el HTML autónomo de lector/wiki. Extensión local posterior a bf6669a: PRODUCT.md y DESIGN.md conservan la autoridad del producto y del sistema visual. El sidecar `offline-preparation.json` registra muestras locales; no sustituye `.impeccable/design.json` ni introduce una nueva paleta.

## Overview

La preparación se incorpora a las superficies existentes: Overview muestra crecimiento documental, siguiente acción, creación contextual y consejos manuales; Library recuerda aperturas de esta sesión de ventana y ofrece marcadores contextuales; la wiki permite seleccionar documentos y organizar secciones; Sesiones amplía una fila con preparación y resumen manual. La apariencia añade efectos opcionales en el fondo del espacio de trabajo.

## Colors

Se heredan carbón, superficies tonales, bordes y oro del escritorio. Las acciones primarias usan oro con tinta oscura; los secundarios usan texto claro y hover tonal. El primario Crear conserva su fondo dorado al hover mediante brillo, sin heredar el fondo del secundario. La ficción conserva sus tokens nativos aislados. Las opciones de apariencia pertenecen al proyecto/era y las paletas del lector permanecen independientes.

## Typography

Se mantienen las pilas Cinzel para títulos y Source Sans 3 para controles del marco, con respaldos locales definidos en DESIGN.md. Overview usa títulos serif y cuerpo de interfaz; la preparación nativa tiene título de 15px/600 y ayudas de 12px con interlínea 1.5. No se añaden fuentes descargadas ni una nueva escala global.

## Layout

Los paneles de Overview usan borde, superficie tonal, esquinas de 12px y relleno de 20px. El crecimiento presenta mes, barra y cifra en tabla desplazable: la barra acompaña al recuento escrito. La creación se despliega bajo el motor elegido; botones y consejos se distribuyen con flex-wrap.

La wiki despliega la selección múltiple mediante details: búsqueda/tipo, selección visible, recuento y acciones de incluir/omitir/mover preceden a una lista con desplazamiento propio. Seleccionar un documento y admitirlo en el perfil son controles distintos. El guardado del perfil conserva la configuración; la publicación usa su edición capturada. Las secciones anidadas conservan controles de orden y destino accesibles además del arrastre.

La preparación de sesión se expande dentro de la tabla existente. Los metadatos usan columnas automáticas de mínimo 220px limitado al ancho disponible, separadas 12px; gancho, notas privadas y resumen ocupan su fila. Asistencia y acciones se envuelven con separación de 8px. Las ayudas de zona horaria, privacidad y resumen permanecen junto al campo o acción que explican.

## Elevation & Depth

La ampliación usa bordes y capas tonales existentes. El menú de marcador se monta sobre el documento, se limita a los bordes de la ventana y recibe foco al abrirse; Escape o puntero exterior lo cierran y el foco previo se restaura si sigue disponible.

Los efectos none/snow/rain/embers/fireflies son decorativos, sin objetivos de interacción. none es el valor por defecto; rendimiento o movimiento reducido de la app retiran partículas y la preferencia del sistema las oculta. La intensidad configura cantidad; no comunica estado operativo. Las capturas estáticas no acreditan su comportamiento temporal.

## Shapes

Se conservan campos y botones redondeados de 8px y bordes finos del escritorio. Los controles nuevos de Overview tienen altura mínima de 40px; los de selección wiki y apariencia mantienen sus medidas propias. Estas medidas locales no sustituyen los tokens globales ni la geometría de los controles nativos de ficción.

## Components

**The Local Draft Rule.** Plegar o cambiar una preparación de sesión conserva el borrador, error y estado guardado en la caché de la vista por mundo/sesión. Al recibir datos nuevos se rebasan los campos no editados; una respuesta tardía de un propietario antiguo no sustituye el borrador posterior. Esta caché no implica persistencia tras desmontar SessionsPage, cerrar o reiniciar la app.

Guardar, iniciar, marcar jugada y marcar resumen listo son acciones explícitas con estados de espera y mensajes. El resumen listo guarda texto manual; no envía mensajes. Las notas DM quedan fuera del contexto de Faustus y del resumen descargado; el JSON privado completo sí las conserva. No se deriva una garantía de secreto del simple ocultamiento de navegación.

**The Search Intent Rule.** Una consulta con filtros, exclusiones o frases entrecomilladas sigue siendo búsqueda y no ofrece creación rápida. El texto simple puede crear mediante los motores habilitados y el contexto Base/era admitido.

Los marcadores contextuales reutilizan ubicación y Deshacer con comprobación de revisión. Abiertos desde Library es memoria de esta sesión de ventana, por proyecto/era; no es un historial durable ni incluye aperturas hechas desde otras herramientas.

## Do's and Don'ts

- **Do** conservar identidad, densidad, estados escritos y foco del escritorio Writer.
- **Do** mantener tinta oscura y fondo dorado legibles en reposo y hover de Crear.
- **Do** distinguir selección múltiple, inclusión en perfil y guardado/publicación.
- **Do** conservar borradores de preparación durante plegado y cambio de sesión dentro de la vista.
- **Don't** presentar un borrador local como guardado en disco o un resumen listo como enviado.
- **Don't** promover colores de un perfil, documento o apariencia a una identidad global nueva.
- **Don't** presentar el lector a 390px como soporte móvil del escritorio completo.

## Evidence and limits

Contrato: `_stage/qa-codex/DESIGN-CONTRACT.md`. Revisión completa: `_stage/impeccable-finish-review.md`. Veredicto final: `_stage/impeccable-finish-verdict.md`, disposition **ship**, exclusivamente para los dos hallazgos puntuados y resueltos: conservación de borradores y contraste de Crear al hover. No es una nueva auditoría ni aprobación global.

Capturas sintéticas existentes en `.impeccable/review/1095-next/`: home-desktop, home-primary-hover, library-session, wiki-curation, fiction-prep, fiction-recap, fiction-draft-reopened, wiki-output-desktop, wiki-output-390 y wiki-output-390-content (PNG). Las dos vistas de preparación/resumen son tramos desplazados del mismo formulario. El lector de 390px es una prueba aislada de HTML en iframe; el marco oscuro exterior no es contenido ausente. La interfaz de escritorio se comprobó mediante Browser, sin entrada al escritorio de Luis.

Este registro contrasta fuentes actuales y capturas existentes; no vuelve a ejecutar Browser, Electron, MCP, suites ni detector. Las verificaciones funcionales y límites de capacidades se conservan en `tasks/vvd1095/verification-next.md` y `docs/OFFLINE-PREPARATION.md`. No acredita contraste de todas las combinaciones configurables, lector de pantalla, rendimiento de proveedores ni ejecución temporal de efectos. El advisory heredado del acento claro #725221 no se convierte aquí en un token nuevo ni se repara drift.
