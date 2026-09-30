# Writers Hoard 0.1.4: engine de Investigación y fuentes calificadas

Versión preliminar para Windows x64 y Linux x64.

## Al actualizar desde 0.1.3

La base de datos pasa a la versión 35. Los proyectos, capítulos y citas existentes se conservan tal cual; las citas antiguas aparecen como «sin calificar». No hace falta hacer nada.

## Novedades

- **Engine «Investigación»** para proyectos de periodismo, biografía o no ficción. Viene activado en el modo Reporter y sugerido en Biographer y Realist. Pestañas:
  - **Afirmaciones:** cada afirmación se apoya en fragmentos literales de tus fuentes. Su estado se calcula a partir de ellos: afirmada, corroborada (dos orígenes independientes), confirmada, discutida, retirada o sin apoyo.
  - **Cronología:** con consulta «a fecha de». Distingue un hecho terminado (con fecha de fin) de una observación desactualizada.
  - **Grafo:** afirmaciones entre entidades del Codex, coloreadas por estado.
  - **Hipótesis:** matriz de hipótesis rivales con diagnosticidad de cada prueba. La menos contradicha se presenta como tal, no como demostrada.
  - **Entidades.**
  - **Informe:** en Markdown, con comprobación de citas.
- **Calificación de fuentes.** Cada cita admite fiabilidad A-F, credibilidad 1-6 y origen.
  - Una fuente se puede **retirar** y restaurar sin borrarla. Al retirarla, lo que dependía solo de ella queda «sin apoyo».
  - Una cita que respalda afirmaciones no se puede borrar: hay que retirarla.
- **Bibliografía:** las fuentes retiradas siguen en la lista, marcadas con la fecha y el motivo, en APA, MLA y Chicago, y en todas las salidas: texto, Markdown, HTML, EPUB y DOCX. La vista previa de publicación indica cuántas hay.
- **Wikidata:** completa fichas del Codex desde el proceso principal. Cada ejecución queda registrada y se puede deshacer.
- **Privacidad:** una persona del Codex no se enriquece ni se busca fuera salvo que la marques como figura pública.
- **Biblioteca de la familia:** búsqueda opcional en Borges y Links a través del Hub, si está abierto.
- **Puente de IA:** 141 herramientas.
  - 14 nuevas para investigación y calificación de fuentes, entre ellas `wh_add_claim`, `wh_retract_source`, `wh_ach_matrix`, `wh_enrich_codex` y `wh_inquiry_report`.
  - `wh_bibliography` devuelve la bibliografía tal como se exporta, con el grado de cada fuente y las retiradas marcadas.
  - `wh_import_story_session` importa sesiones de Scheherazade's Hoard como capítulos. Repetir la importación no duplica nada, y no pisa las ediciones del autor.
  - La primera línea de cada descripción es más corta, para el índice de herramientas.
- Documentación de la familia Hoard en inglés y español.

## Descargas y requisitos

- **Windows x64:** `Writers-Hoard-Setup-0.1.4.exe`. Instalador preliminar sin firma digital, como las versiones anteriores.
- **Linux x64:** `Writers-Hoard-0.1.4.AppImage`. Concede permiso de ejecución. Las herramientas multimedia completas requieren glibc 2.38 o posterior; gallery-dl no funciona con glibc 2.36.
- **SHA256SUMS.txt:** sumas de comprobación. Los archivos `.yml` y `.blockmap` sirven al actualizador.

## Validación

Pasan las pruebas críticas, la comprobación de tipos, el lint, la conformidad de los 24 engines, las pruebas de investigación (lógica, migración de v34 a v35, enriquecimiento, interfaz, puente y autotest del puente) y las de suscripciones.

El paquete de Windows arranca instalado sobre 0.1.3 y abre la biblioteca existente. La AppImage se compiló en Docker (`node:22-bookworm`) y arranca en `debian:trixie` con un usuario sin privilegios.

Los textos del engine Investigación se cargan con el propio engine y no al arrancar la app.

Los archivos «Source code» generados por GitHub contienen la documentación pública del repositorio de releases. El código fuente está en https://github.com/Luissalet/Writers-Hoard-Desktop.
