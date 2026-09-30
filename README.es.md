# Writers Hoard — Escritorio

[English](README.md)

Plataforma local de escritura creativa empaquetada como aplicación de escritorio con **Electron**. Comparte la base React/Vite/Dexie con la versión web, pero la ventana nativa amplía los límites de almacenamiento del navegador e incluye descargas multimedia con `yt-dlp` y `gallery-dl`, sin servidor Python aparte.

> Plan de transición: [`tasks/desktop-transition.md`](tasks/desktop-transition.md).

## Empezar

```sh
npm install
npm run fetch:bin
npm run verify:quick
npm run dev:desktop
```

`npm run dev` abre solo la versión web. En Windows, `setup.bat` instala una vez y `run.bat` inicia la app sin reinstalar dependencias.

## IA y asistentes externos

En **Ajustes de IA → Usar mis suscripciones**, inicia sesión mediante el cliente oficial de Claude o Codex, o importa una sesión ya existente. Comprueba la conexión y selecciónala como modelo de texto. También siguen disponibles las conexiones API y los modelos locales. Las solicitudes de suscripción verifican el método de autenticación y no derivan automáticamente a facturación API. Texto y copiloto están soportados; la generación de imágenes usa proveedores separados.

La sección **Puente de IA** muestra cómo conectar Claude Desktop, Codex o Gemini CLI con la app mediante configuraciones específicas por cliente. Mantén Writers Hoard abierto mientras esté conectado. Una conversación web corriente no adquiere acceso pegando un prompt o una dirección localhost. Consulta [suscripciones](docs/ai-subscriptions.md) y [asistentes externos](docs/ai-external-connection.md).

## Investigación (proyectos de investigación)

El motor **Investigación** (`inquiry`, categoría investigación; activo por defecto
en el preset Periodista y sugerido en Biógrafo y Realista) convierte la
investigación que ya tiene un proyecto en afirmaciones y razona sobre ellas.

- **Las fuentes se gradúan y se pueden retractar.** Cada cita puede llevar una
  fiabilidad (A-F) y una credibilidad (1-6), que se muestran como `B2`, y un
  origen con el que se juzga la independencia. Las citas anteriores figuran como
  «sin graduar». Retractar una fuente nunca la borra ni borra sus extractos: las
  afirmaciones que se apoyaban en ella se recalculan y la app dice cuántas se
  vieron afectadas. Una fuente retractada sigue en la bibliografía, marcada con
  la fecha y el motivo, en todos los estilos de cita y formatos de publicación;
  la vista previa de publicación indica cuántas hay.
- **Las afirmaciones se apoyan en extractos registrados.** Una afirmación es un
  enunciado (con sujeto, predicado y objeto opcionales y fechas parciales) con al
  menos un apoyo que apunte a un extracto existente. Su estado no se guarda: se
  deriva cada vez como sin respaldo, afirmada, corroborada (dos o más orígenes
  independientes), confirmada o en disputa (decisión del autor) o retractada, y
  siempre se muestra junto a sus recuentos de extractos y fuentes independientes.
- **Tiempo.** Toda vista admite una fecha «a fecha de». Una afirmación cuyo
  periodo ha terminado está *terminada*; una que no se ha visto en más del plazo
  de caducidad (365 días por defecto) está *desactualizada*.
- **Pestañas:** Afirmaciones, Cronología (con contradicciones en predicados de
  un solo valor y tramos desconocidos), Grafo, Hipótesis (análisis de hipótesis
  en competencia, redactado como «la menos contradicha hasta ahora», nunca
  «demostrada»), Informe (Markdown con comprobación de citas; un resumen de
  modelo opcional debe superarla y se marca, no se oculta) y Entidades.
- **Privacidad.** Una persona del códice es privada salvo que el autor la marque
  como figura pública. El enriquecimiento nunca se ejecuta sobre una persona
  privada, las búsquedas en la biblioteca quitan sus nombres de la consulta y el
  informe las rotula «persona privada».
- **Consultas.** Organizaciones, lugares, sucesos y figuras públicas se pueden
  vincular con Wikidata desde el proceso principal (User-Agent identificado,
  peticiones en serie, tiempos de espera). Al aplicar solo se rellenan los campos
  vacíos, se guarda el identificador, se archiva una fuente C3 y se registra una
  ejecución que se puede deshacer. La app de escritorio también puede buscar en
  las demás apps locales del usuario a través del hub de Hoard (`library_search`,
  `search_links`); los resultados pasan a ser fuentes sin graduar y, si el hub no
  está en marcha, se avisa sin que sea un error grave.
- **Puente de IA.** `wh_grade_source`, `wh_retract_source`, `wh_list_claims`,
  `wh_add_claim`, `wh_update_claim`, `wh_inquiry_timeline`, `wh_add_hypothesis`,
  `wh_rate_hypothesis`, `wh_ach_matrix`, `wh_enrich_codex`,
  `wh_undo_enrichment`, `wh_inquiry_report`, `wh_search_library` y
  `wh_bibliography`, la bibliografía con grados y retractaciones marcadas (detalle en
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md)).

`npm run test:inquiry` ejecuta sus pruebas específicas (lógica pura, migración,
enriquecimiento, interfaz y herramientas del puente).

## Comandos principales

| Comando | Función |
| --- | --- |
| `npm run dev:desktop` | Inicia Vite y Electron con recarga en desarrollo. |
| `npm run build` | Comprueba tipos y construye la interfaz web. |
| `npm run build:desktop` | Construye interfaz y procesos de Electron. |
| `npm run verify:quick` | Tipos de renderer/Electron, lint de publicación y conformidad. |
| `npm run test:critical` | Pruebas aisladas de migración, copias, recuperación, navegación y arranque. |
| `npm run test:inquiry` | Pruebas del motor Investigación: lógica pura, migración, enriquecimiento con Wikidata simulado, interfaz y herramientas del puente. |
| `npm run test:subscriptions` | Pruebas de aislamiento de suscripciones y protocolo sin llamar a proveedores. |
| `npm run dist` | Genera un instalador local; `dist:publish` exige firma y comprobaciones de release. |

El renderizador detecta Electron para usar `HashRouter` bajo `file://` y ofrecer el descargador multimedia. El build web mantiene su despliegue independiente. La arquitectura de la ventana, preload y servicio multimedia se explica en el [README inglés](README.md).

## Releases

La [guía de releases](docs/RELEASES.md) describe los instaladores para Windows/Linux, checksums y publicación. Las actualizaciones se muestran en la barra de título; descarga e instalación requieren una acción explícita del usuario. El repositorio público de distribución es independiente de este código fuente privado: solo instaladores, metadatos de actualización, checksums y documentación pública deben copiarse allí.
