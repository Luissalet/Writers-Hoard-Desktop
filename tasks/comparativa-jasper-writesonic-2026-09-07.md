# Jasper y Writesonic frente a Writer’s Hoard

Fecha: 7 de septiembre de 2026. Investigación terminada; propuestas sin implementar.

Actualización de estado: la primera entrega de implementación está descrita en [herramientas-escritura-implementadas-2026-09-07.md](herramientas-escritura-implementadas-2026-09-07.md). Este documento conserva la comparación y la selección de alcance originales.

## Alcance

Writer’s Hoard sirve también a periodistas y otros autores, además de narrativa. La comparación considera ficción, artículos, investigación documental, ensayo y trabajo editorial. Se contrastó documentación oficial con código actual conectado. No se probaron cuentas comerciales ni se evaluó a ciegas la calidad de sus textos. Las ventajas documentadas no demuestran mejor prosa, precisión o resultados de posicionamiento.

## Resultado

Las oportunidades seleccionadas son investigación asistida y procedencia de fuentes, contexto editorial reutilizable, voz propia y flujos de redacción. El usuario excluye trabajo con editores y publicación digital. Las diferencias comerciales de la tabla se conservan como investigación competitiva, no como objetivos del producto. La adaptación debe servir a narrativa, periodismo, ensayo y otros autores mediante las herramientas actuales de Writer’s Hoard.

| Área | Competidores | Writer’s Hoard y oportunidad |
| --- | --- | --- |
| Voz reutilizable | Jasper extrae un perfil de muestras y compara generaciones con y sin voz. | No se encontró perfil persistente equivalente. El copiloto recibe instrucciones para respetar la voz existente. Falta perfil editable de autor/publicación y excepciones por pieza. |
| Contexto y reglas | Jasper IQ reúne conocimiento, voz, públicos y guías aplicables en varias superficies. | Ya tenemos Códice, referencias, criterios y contexto del proyecto. Falta reunirlos en una configuración editorial común aplicada durante la generación. |
| Investigación | Writesonic documenta fuentes web o propias, elección de referencias y esquema antes de redactar. | Tenemos recortes, biblioteca y análisis con fuentes; no se identificó investigación web autónoma actualizada integrada en redacción. Brecha relevante para periodistas. |
| Procesos repetibles | Jasper Grid configura entradas, procesamiento y resultados; Writesonic guía la producción del artículo. | Existen recetas de herramientas, plantillas narrativas y conversiones con deshacer. No se encontró constructor equivalente de flujos textuales multietapa. |
| Revisión compartida | Jasper Canvas documenta coedición y comentarios. | No se encontró coedición nativa con roles editoriales. Google Docs sincroniza hacia dentro; no equivale a una redacción colaborativa propia. |
| Publicación | Writesonic anuncia conexiones a WordPress, Webflow, Ghost y otros CMS. | Exportamos Markdown, HTML, PDF, DOCX y EPUB. No se encontró publicación directa en CMS. Es relevante para prensa digital y blogs. |
| Descubrimiento | Writesonic ofrece SEO y seguimiento de citas/menciones en respuestas IA; Jasper también ofrece GEO. | No se encontró equivalente. Útil para distribución digital; prioridad posterior a investigación y revisión. |

## Fuentes oficiales

- [Jasper Brand Voice](https://help.jasper.ai/hc/en-us/articles/18618693085339-Brand-Voice): muestras, perfiles y prueba con/sin voz. La ayuda diferencia Pro y Business; Style Guide requiere Business.
- [Jasper IQ](https://help.jasper.ai/hc/en-us/articles/18618654325787-Jasper-IQ): contexto editorial compartido; la página sitúa el conjunto IQ en Business.
- [Jasper Grid](https://help.jasper.ai/hc/en-us/articles/46746641765787-Jasper-Grid): automatización estructurada y reutilizable.
- [Jasper Canvas](https://help.jasper.ai/hc/en-us/articles/37817833127963-Jasper-Canvas): coedición y comentarios.
- [Writesonic: guía de Article Writer 6](https://docs.writesonic.com/docs/aritcle-writer6-10-step-article): flujo guiado, fuentes y configuración. Documentación de versión anterior: no implica que la interfaz actual conserve exactamente esos pasos.
- [Writesonic: Article Writer actual](https://writesonic.com/ai-article-writer): anuncia investigación, revisión, voz y CMS. Sus promesas de verificación y calidad no se validaron independientemente.
- [Writesonic: GEO](https://docs.writesonic.com/docs/geo-getting-started): visibilidad y comparación con competidores.

## Lo que ya tenemos

- Copiloto conectado con lectura, escritura y deshacer: `src/components/layout/MainLayout.tsx`, `src/services/copilot/runner.ts`, `src/services/aiRuntime/prompts.ts`, `src/services/aiBridge/manifest.ts`.
- Biblioteca PDF/Markdown/TXT y evaluación con referencias: `src/services/judge/library.ts`, `src/services/judge/text.ts`, `src/services/judge/runner.ts`, `src/engines/writings/components/JudgePanel.tsx`. Recuperación léxica y comprobación de citas contra fragmentos suministrados. Esto no verifica que la fuente diga la verdad. No se identificó OCR para documentos sin capa de texto.
- Análisis del proyecto con fuentes, bibliografía sencilla APA/MLA/Chicago, conversiones y exportación: `src/services/projectTools.ts`, `src/types/projectTools.ts`. Pedir citas en un prompt no garantiza verificar todas las afirmaciones.
- Recetas de herramientas y conversiones: `src/components/project/ProjectToolsPanel.tsx`. Plantillas narrativas: `src/engines/outline/components/OutlineEngine.tsx`.
- Búsqueda transversal: `src/services/projectSearchIndex.ts`; Google Docs hacia el proyecto: `src/services/googleDocs.ts`.
- Desarrollo narrativo: Códice, relaciones, arcos, cronología, mapas, escenas y laboratorio creativo. Diferenciación útil para ficción, sin reducir el público a novelistas.
- Almacenamiento local y modelos locales/remotos. Una llamada remota envía el material seleccionado fuera del equipo; la privacidad depende de la conexión elegida.

MCP no es exclusivo: [Jasper también lo documenta](https://developers.jasper.ai/docs/jasper-mcp-server). La diferenciación debe estar en las tareas que podemos resolver.

## Prioridades seleccionadas y adaptación al producto

1. **Investigación y trazabilidad.** Ampliar biblioteca/recortes con búsqueda web opcional, fecha y procedencia, fragmentos citables y vínculos entre afirmación y fuente. Separar dato contrastado, declaración atribuida, interpretación y pendiente. Una cita válida no prueba veracidad. Para entrevistas, estudiar transcripción con marcas temporales; esta investigación no confirmó paridad competitiva en transcripción.
2. **Contexto y guía editorial.** Reutilizar referencias y criterios existentes; añadir reglas por proyecto, voz de autor, ejemplos y configuración por pieza. Para ficción, canon y narrador; para periodismo, atribución, terminología y reglas editoriales. Evitar que la voz altere citas textuales. Mostrar las fuentes y reglas activas; permitir excepciones deliberadas.
3. **Flujos completos y editables.** Periodismo: pregunta → dossier → esquema → borrador → revisión de afirmaciones. Ensayo: tesis → evidencia → contraargumentos → estructura → revisión. Narrativa: idea → alternativas → escena → continuidad. Conservar fuentes, versiones y control del autor en cada paso. Integrar estos recorridos en notas, recortes, biblioteca, esquema, escritos y evaluador existentes, con pasos opcionales, resultados editables y deshacer.

Fuera del alcance seleccionado: trabajo compartido con editores, coedición, roles de redacción y publicación digital/CMS. La revisión individual y asistida del propio texto sigue incluida. No añadir objetivos de campañas, SEO o métricas de marca como consecuencia automática de esta comparación. La exportación de documentos existente sigue siendo una capacidad del producto.

Criterios de adaptación: almacenamiento local, conexiones IA elegibles, reutilización del núcleo de herramientas por copiloto y MCP, distinción entre material original y sugerido, y procesos que acompañen la escritura sin imponer una secuencia obligatoria.

## Verificación pendiente de calidad

Para afirmar quién escribe mejor hace falta una prueba común en español: artículo con dossier y fuentes contradictorias; cita de entrevista que debe mantenerse literal; reescritura con guía editorial; escena con restricciones de canon. Evaluar a ciegas exactitud, atribución, omisiones, fidelidad a la voz, correcciones necesarias, tiempo y coste. Registrar modelo y plan. No se realizó en esta investigación.

## Revisión

Fuentes oficiales contrastadas con recorridos de código. Sin modificación de la aplicación ni pruebas de software: la entrega es documental. «No encontrado» se refiere al alcance del código revisado. Las prioridades son recomendaciones, no funciones implementadas.
