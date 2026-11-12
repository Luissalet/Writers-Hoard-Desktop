# Oro de personaje Daggerheart — #3044

## Uso en Partida, Papel y JSON

En **Fichas → Personaje Daggerheart → Partida → Oro**, marca **Puñados** (0–10), **Bolsas** (0–10) o **Cofre** (0–1). Al pulsar una casilla queda marcado el tramo hasta ella. Si pulsas de nuevo la última casilla marcada, reduces ese contador en uno. Cada contador es independiente: no hay conversiones automáticas, gasto ni traslado de unidades. Guarda con la acción habitual de la ficha. Una ficha de adversario no recibe el control.

Las fichas antiguas sin `daggerheartGold` se leen como 0/0/0 sin migración ni escritura. Base y era siguen el guardado normal: la era hereda los datos de Base hasta que guarda su variante; editar la era no cambia Base. Papel añade la sección localizada de Oro cuando la ficha contiene `daggerheartGold`. Al abrir una ficha antigua sin esos datos, su Papel conserva el diseño anterior. La sección mantiene sus coordenadas al dibujar tinta. Exportar e importar JSON conserva los tres contadores en `daggerheartGold` cuando está presente.

## MCP

`wh_sheet_get` expone los valores efectivos en `derived.daggerheart.gold` para una ficha de personaje. Lee la `revision` de `sheet` y usa `wh_sheet_daggerheart_action` con `projectId`, `sheetId`, `revision`, `action: 'gold'`, `goldUnit: 'handfuls' | 'bags' | 'chest'` y `value`. `value` es el total entero del contador, no un incremento, y debe respetar su capacidad. Para una era, incluye `eraId` tanto en la lectura como en la escritura.

Se comprueba la revisión de la ficha antes de escribir y se rechazan unidades desconocidas, valores fuera de rango o un preset que no sea de personaje. Repetir el valor actual con una revisión válida devuelve `noChange` sin materializar el oro ausente. Las escrituras usan el Deshacer habitual por recibo, dentro del ámbito de la ficha. No se añade otra herramienta MCP.

## Contraste y verificación

`REFERENCE.md`: la demo pública VVD Daggerheart Character Sheet 0.1.9 mostró diez marcadores de puñados, diez de bolsas y uno de cofre. La secuencia 3/2/1 y la reducción a dos al volver a pulsar el 3 acreditan el gesto en el tramo inferior. `REFERENCE-CARRY.md` recoge el contraste posterior: comprobó que el décimo puñado pasa a bolsa y la décima bolsa a cofre, incluso en cadena desde nueve bolsas. Con el cofre marcado, la demo borra las diez bolsas. Writer #3044 mantiene los contadores independientes al llegar al límite. El seguimiento del acarreo y del cofre lleno queda en #3049. La demo volvió a cero al reabrir; no se creó una ficha ni se tocó un mundo. El gesto de equipo Primary/Secondary fue un contraste separado. `BRAVE-RED.md` registra Writer anterior (`8a9c5cc7`) con Hope, PV, estrés y armadura, pero sin oro en Partida.

Los recibos están en `Research/writer-parity-20261110/daggerheart-gold/`. `COMMIT-CUT3044-r1.json` (SHA-256 `32ef799f023a7aa86e7370f9753c9b14c8aeb1db0edb4c1e798361016b8860ad`) registra siete rutas y siete hashes del candidato `965470d074d910c4fcff5372435ee1100e00cb24` sobre `305e349a1eaf2d1727ca49e6d7ce5595ab2d65fc`.

- `BRAVE-GREEN.md`: el candidato marcó 3/2/1 y redujo puñados a dos al pulsar el extremo. Base guardó 2/2/1; Later heredó esos valores, guardó 7/2/1 y reabrió en frío. Base reabrió 2/2/1. El adversario Rival no mostró Oro. Se verificaron las etiquetas castellanas en Partida y Papel. El primer intento con una ficha sembrada directamente causó conflicto de revisión; se retiró y se repitió con creación normal. Limpieza: 89 tablas de prueba vacías y pestaña cerrada.
- `CONTRACT.log`: PASS para validación, cero en ficha antigua sin escritura, Papel y coordenadas de tinta, JSON, Base/era y revisión obsoleta. Rechaza un JSON parcial y oro en adversarios. El Papel antiguo no gana una sección por abrirlo.
- `native3044/run-20261112T062837Z-037700de/RESULT.json`: dos claves, diez llamadas MCP y un Deshacer, once respuestas IPC. A leyó 0/0/0 sin campo guardado; B escribió puñados y bolsas en Base, y cofre en la era. JSON de la era reflejó 3/2/1; Deshacer devolvió 3/2/0 y el renderer quedó acorde con Base. SHA-256 del resultado `783ccb896f21acbf8d7870e3dd2da0fd1989b1e34c6471eaac7aa9c08c79e162`. El recibo `NATIVE-RETIRE3044-run-20261112T062837Z-037700de.json` confirma puerto cerrado y perfil retirado.
- `SUITES.json`: Quick y Build terminaron con código 0. `QUICK.log` registra 34 motores, 64 tablas de motores y cero advertencias conocidas de conformidad; `BUILD.log`, compilación de producción en 2m 19s. `DETECT.json` registra `[]`.
- `CAS3044-r1.json`, `MERGE3044-RESULT-r1.json`, `RETIRE3044-FINAL-r1.json` y `DONE3044-r1.json`: revisión independiente r1 del commit exacto, integración por fast-forward, retirada normal del worktree y la rama de Source, y cierre de #3044.
- `MANUAL3044-r1.json`: se verificó la incorporación de 207 caracteres sobre Partida, Papel y valores por era. Se conservaron 895 párrafos y 79 listas.

El corte cubre los tres marcadores de oro de personaje. El modo de monedas contadas y los cambios de equipo quedan fuera, así como la paridad general con la referencia.
