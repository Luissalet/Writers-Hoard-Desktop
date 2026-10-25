# Verificación: submenús propios del SDK local

## Uso y alcance

En un proyecto con **Contador contextual** habilitado, abra un documento Source. Acciones conserva Incrementar y Restablecer planos, y añade **Más acciones → Incrementar** y **Más acciones → Cuenta → Restablecer**. Los botones normales siguen disponibles. Las hojas llaman a las mismas funciones que los botones y las operaciones MCP; Deshacer/Rehacer explícitos usan los recibos de ese montaje. Compilar un ejemplo no lo habilita automáticamente.

La rama se abre con clic, Enter, Espacio o flecha derecha; no hay apertura por hover ni temporizadores. Arriba/Abajo/Inicio/Fin recorren sólo el nivel actual y omiten filas deshabilitadas. Izquierda, Escape o Atrás vuelven al padre; Escape en raíz cierra el árbol. Atrás sigue disponible si los paneles se solapan en una ventana estrecha. Tab y Mayús+Tab cierran todo y permiten continuar el recorrido normal.

## Contrato propio

`LocalToolMenuEntry` añade `{kind:'submenu', id, label, disabled?, entries}` sin cambiar `open(event, entries, {label})` ni `close()`. Los IDs son únicos en todo el árbol, incluidas hojas que comparten callback. El host valida la petición completa antes de consumir el evento o reemplazar un menú válido; rechaza ciclos, ramas sin hojas y datos inválidos. Congela sus copias de ramas, arrays y hojas, sin congelar el input del autor ni el objeto options.

El árbol es efímero y conserva dueño de instancia, documento, proyecto/época y release seleccionada. Cada apertura hija se revoca al cerrarse; volver A→B→A no adopta nodos retirados. Foco y pointer entre paneles pertenecen al mismo menú. Cambiar contexto, ocultar, retargetear o desmontar retira la presentación. Antes de una hoja se elimina todo el DOM del menú y se devuelve foco al trigger; eso no garantiza foco persistente tras posteriores renders ni cancela efectos arbitrarios ya iniciados por un callback.

Sin host, el puerto devuelve false y deja el evento intacto. El fake/grabador devuelve false y copia metadata recursiva serializable sin callbacks, eventos o DOM: no presenta ni selecciona. Ningún árbol se guarda en estado, JSON/ZIP, Published o describe. No se añade tool, tabla, permiso o dependencia. Owned, bloques mundiales, readonly/Reader/Published y fullscreen siguen fuera. La guía de [menús 1501](verification-sdk-context-menus.md) conserva la entrega plana histórica; la ampliación no cambia tours/controller/store.

## Evidencia separada

- **Autor:** RED material 807448… con Source real: botón 0→1 y menú plano 1→2 positivos antes de fallar la rama. El mismo archivo completo SHA 807448447ab1faca4d7478056581959acf6b189c76f8acd246415fc840c9717a pasa GREEN y hoja 3. Tras ampliar focos, Browser final 0f8de554… pasa 15 grupos CSS; Node público 7 incluye fake y validación de árbol de 400 niveles, CLI pack/check y test de módulo; Native 1 conserva wrapper y comprueba ejecutor→IPC, operaciones/recibos Base/era y selección anidada real de Source. TSC app y lint pertinentes exit0. Son ejecuciones distintas con capacidades solapadas, no una nueva batería global.
- **Revisión técnica independiente:** cuatro grupos CSS propios, primera ejecución exit0, sin hallazgos materiales pendientes. Comprueba admisión/copia profunda, interior/callback/recibo, apertura retenida y leases, y fake. No es voto CAS ni prueba Native propia. Informe íntegro: `_stage/sdk-submenus-next/technical-review/TECHNICAL-REVIEW.md`.
- **ROOT Brave:** tres niveles por pointer y teclado, Izquierda/Escape/Atrás, Tab→Deshacer y Mayús+Tab→Restablecer nativos. Incrementar guardó 3; Restablecer 0 y Deshacer 3; frío dejó 3 y cero paneles, con historial del montaje no persistido. El segundo Source conservó 1. Una lectura posterior al guardado vio BODY: la garantía de foco dentro del callback procede de los oráculos, no de esa lectura tardía. Se conserva el timeout del operador que esperaba 0 tras un segundo Deshacer, aunque correspondía 2; Rehacer asentado confirmó 3, sin corregir producto para esa expectativa. Registro: `_stage/sdk-submenus-next/ROOT-brave.md`.

Cuatro PNG asentadas EN/ES1280/390 fueron abiertas por autor; ROOT abrió el JPEG1920×917 de la app real. Los primeros frames se excluyen. Son vistas Electron y Brave distintas, no prueba móvil física. Warnings de Network/React act y rechazo esperado de recibo ajeno permanecen. El primer agregado falló por activeElement sin focusin en Electron oculto; el diagnóstico conserva 0 eventos y el fixture usa el mismo evento explícito del original, sin cambiar producto ni debilitar aserciones.

## Recibos verificados

Fuente de autor: FREEZE5 d6bf5bc7…; ROOT congeló el conjunto 8 para sus comprobaciones. Guardas 57/foreign2 exactas en el freeze de autor; el runner posterior pertenece a ROOT. Fuente, revisión formal, gates, Main y manual constan en sus recibos reales; acabado final ship tras F1 documental, MEMORY y grafo propio confirmados:

| Registro | Estado confirmado |
| --- | --- |
| Commit fuente | `dc10fc314f5fa4231c9d32752fd2372cecb76120`; ocho rutas explícitas, Luissalet. |
| Revisión y voto CAS | approve38 sobre commit exacto; tarea leída antes de CSS4 propios y voto real confirmado. |
| Gates de fuente ROOT | 12 exit0: quick/build/Electron/crítica396/manifiesto2/Node7/CSS15/Native1/tours15+10/SDK6/author-kit2. |
| Main | FF bajo merge lock/HEAD fresco; nueve checks exit0, fuente exacta y merge liberado. |
| Manual | +447UTF16, revisión exigida/readback completo; estructura, otros párrafos y estilos exactos. |

La referencia oficial sólo acredita `submenu` documentado; no se ejecutó su runtime SDK ni se afirma ABI equivalente. Pack/check no es instalación end-to-end. Native no demuestra presentación headless, stdio externo o segunda clave. Apertura explícita, texto plano y hosts acotados: no paridad universal. SDK general y tarea1095 siguen parciales/abiertos. La integración documental y el cierre1505 se registran tras ocurrir en ROOT-delivery-final.json; sin push.
