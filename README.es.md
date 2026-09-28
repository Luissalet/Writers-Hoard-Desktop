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

## Comandos principales

| Comando | Función |
| --- | --- |
| `npm run dev:desktop` | Inicia Vite y Electron con recarga en desarrollo. |
| `npm run build` | Comprueba tipos y construye la interfaz web. |
| `npm run build:desktop` | Construye interfaz y procesos de Electron. |
| `npm run verify:quick` | Tipos de renderer/Electron, lint de publicación y conformidad. |
| `npm run test:critical` | Pruebas aisladas de migración, copias, recuperación, navegación y arranque. |
| `npm run test:subscriptions` | Pruebas de aislamiento de suscripciones y protocolo sin llamar a proveedores. |
| `npm run dist` | Genera un instalador local; `dist:publish` exige firma y comprobaciones de release. |

El renderizador detecta Electron para usar `HashRouter` bajo `file://` y ofrecer el descargador multimedia. El build web mantiene su despliegue independiente. La arquitectura de la ventana, preload y servicio multimedia se explica en el [README inglés](README.md).

## Releases

La [guía de releases](docs/RELEASES.md) describe los instaladores para Windows/Linux, checksums y publicación. Las actualizaciones se muestran en la barra de título; descarga e instalación requieren una acción explícita del usuario. El repositorio público de distribución es independiente de este código fuente privado: solo instaladores, metadatos de actualización, checksums y documentación pública deben copiarse allí.
