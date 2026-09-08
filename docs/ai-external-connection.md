# Usar una IA externa con Writers Hoard

En **Ajustes → IA → Puente IA**, la sección **Conectar una IA externa a Writers Hoard** ofrece una configuración específica para Claude Desktop, Codex o Gemini CLI y un mensaje de inicio para copiar en la conversación. La guía se puede leer incluso con el puente desactivado.

1. Abre Writers Hoard, activa el puente y comienza con la escritura desactivada. El adaptador incluido necesita Node.js accesible como `node`; si el cliente no lo encuentra, usa la ruta absoluta del ejecutable en `command`.
2. Selecciona el cliente y añade la configuración al archivo indicado conservando los ajustes existentes. La configuración contiene un token local: se pega en el archivo del cliente, no en el chat. No requiere una API key de un proveedor.
3. Reinicia el cliente, verifica que aparece `writers-hoard` y copia el mensaje de inicio en una conversación nueva. La prueba inicial llama a `wh_get_context` sin modificar datos. El mensaje también explica cómo encontrar proyectos, consultar preferencias editoriales, leer antes de escribir y comprobar el resultado.

El puente sirve los mismos permisos, herramientas, confirmaciones, registro y deshacer que ya utiliza la app. Tras cambiar los permisos de escritura, vuelve a conectar el cliente para que descubra el catálogo actualizado. Si regeneras el token, actualiza también la configuración del cliente.

La dirección de loopback que muestra la app es su API local, **no** un endpoint MCP remoto. El cliente lanza `mcpStdio.cjs` y ese adaptador habla con la app. Un mensaje pegado en ChatGPT, Claude o Gemini web no crea esta conexión. Esta función no publica un servidor remoto ni abre un túnel; los chats web necesitan una integración compatible por separado. El mensaje de inicio nunca contiene el token ni rutas locales.

Referencias oficiales consultadas el 8 de septiembre de 2026:

- [Claude Desktop y servidores MCP locales](https://modelcontextprotocol.io/docs/develop/connect-local-servers): JSON en `claude_desktop_config.json`, configuración de `command` y `args`, reinicio del cliente.
- [Codex MCP](https://developers.openai.com/codex/mcp): tablas `mcp_servers` y entorno en `~/.codex/config.toml`.
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/): servidores `mcpServers` en `settings.json` y consulta mediante `/mcp`.

Validación de la guía y su interfaz:

```text
npx electron scripts/run-focused-browser-tests.cjs tests/ai-bridge-connection.browser.tsx testAiBridgeConnection
```

La prueba comprueba formatos, rutas Windows con espacios, ausencia de credenciales en el mensaje en ambos idiomas, cambio de cliente, copia y recuperación de errores. No inicia sesión ni modifica la configuración de ningún cliente externo.
