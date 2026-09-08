# Writers Hoard 0.1.2 — suscripciones y asistentes externos

Versión preliminar para Windows x64 y Linux x64.

## Novedades

- **Claude y Codex con suscripción:** conecta la sesión de su cliente oficial desde Ajustes de IA, comprueba el acceso, selecciona modelos y elige la conexión predeterminada. No hace falta pegar una clave API. Se aplican los límites de tu plan y no se cambia automáticamente a facturación API.
- **Copiloto integrado:** las propuestas de acciones de estos modelos pasan por los permisos, confirmaciones e historial de Writers Hoard. Los clientes oficiales no ejecutan herramientas propias durante estas peticiones.
- **Conexión desde otros asistentes:** guía para Claude Desktop, Codex y Gemini CLI con configuración específica y un mensaje copiable para que el asistente conozca la app y sus herramientas. El mensaje no contiene credenciales.
- Controles y guía en español e inglés; comprobación de sesión, recuperación de errores y cancelación de procesos.

## Descargas y requisitos

- **Windows x64:** `Writers-Hoard-Setup-0.1.2.exe`. Instalador preliminar sin firma digital, como las versiones anteriores.
- **Linux x64:** `Writers-Hoard-0.1.2.AppImage`. Concede permiso de ejecución. Las herramientas multimedia completas requieren glibc 2.38 o posterior; gallery-dl no funciona con glibc 2.36.
- **SHA256SUMS.txt:** sumas de comprobación. Los archivos `.yml` y `.blockmap` sirven al actualizador.

Instala y autentica el cliente oficial Claude Code o Codex antes de importar su sesión. En Linux, inicia sesión desde una terminal y vuelve a comprobar en Writers Hoard. Codex debe admitir el protocolo app-server con entornos desactivados; la app comprueba esa compatibilidad. Los modelos no se incluyen en la descarga.

Estas conexiones admiten texto y copiloto; la generación de imágenes continúa usando los proveedores de imagen. Las respuestas se muestran al terminar el cliente. Para conectar un asistente externo, mantén Writers Hoard abierto y configura el puente local: pegar un mensaje en ChatGPT, Claude o Gemini web no crea por sí solo acceso a la aplicación.

## Validación

Pruebas generales de regresión, pruebas específicas de autenticación, protocolo de herramientas, cancelación y controles de conexión. Claude y Codex han completado pruebas reales de suscripción y un ciclo de propuesta de herramienta con resultado sintético, sin usar datos personales.

Los archivos «Source code» generados por GitHub contienen la documentación pública del repositorio de releases. El código de desarrollo permanece privado.
