# Oro de personaje Daggerheart — #3044 y #3049

## Uso en Partida, Papel y JSON

En **Fichas → Personaje Daggerheart → Partida → Oro**, marca **Puñados** (0–10), **Bolsas** (0–10) o **Cofre** (0–1). Al pulsar una casilla queda marcado el tramo hasta ella. Diez puñados se convierten en una bolsa y diez bolsas en un cofre cuando hay espacio. Si ya hay nueve bolsas, el décimo puñado puede completar el cofre en el mismo gesto. Si el destino está lleno, los diez permanecen marcados. Tras liberar espacio, vuelve a pulsar el diez del contador que quieras convertir. Si el gesto no puede convertir y la casilla era la última marcada, reduce ese contador en uno. Guarda con la acción habitual de la ficha. Una ficha de adversario no recibe el control.

Las fichas antiguas sin `daggerheartGold` se leen como 0/0/0 sin migración ni escritura. Base y era siguen el guardado normal: la era hereda los datos de Base hasta que guarda su variante; editar la era no cambia Base. Papel añade la sección localizada de Oro cuando la ficha contiene `daggerheartGold`. Al abrir una ficha antigua sin esos datos, su Papel conserva el diseño anterior. La sección mantiene sus coordenadas al dibujar tinta. Exportar e importar JSON conserva los tres contadores en `daggerheartGold` cuando está presente.

## MCP

`wh_sheet_get` expone los valores efectivos en `derived.daggerheart.gold` para una ficha de personaje. Lee la `revision` de `sheet` y usa `wh_sheet_daggerheart_action` con `projectId`, `sheetId`, `revision`, `action: 'gold'`, `goldUnit: 'handfuls' | 'bags' | 'chest'` y `value`. `value` es el total entero del contador, no un incremento, y debe respetar su capacidad. Para una era, incluye `eraId` tanto en la lectura como en la escritura.

Se comprueba la revisión de la ficha antes de escribir y se rechazan unidades desconocidas, valores fuera de rango o un preset que no sea de personaje. Al enviar `value: 10` para puñados o bolsas se aplica la misma conversión que en Partida. Repite `value: 10` tras liberar espacio para convertir un contador que ya estaba al límite. Una acción con revisión válida que deja los tres valores iguales devuelve `noChange` sin materializar el oro ausente. Las escrituras usan el Deshacer habitual por recibo, dentro del ámbito de la ficha. No se añade otra herramienta MCP.

## Contadores iniciales (#3044)

`REFERENCE.md`: la demo pública VVD Daggerheart Character Sheet 0.1.9 mostró diez marcadores de puñados, diez de bolsas y uno de cofre. La secuencia 3/2/1 y la reducción a dos al volver a pulsar el 3 acreditan el gesto en el tramo inferior. `REFERENCE-CARRY.md` recoge el contraste posterior: comprobó que el décimo puñado pasa a bolsa y la décima bolsa a cofre, incluso en cadena desde nueve bolsas. Con el cofre marcado, la demo borra las diez bolsas. Writer #3044 mantiene los contadores independientes al llegar al límite. La extensión #3049 verifica el acarreo y la conservación del oro con el cofre lleno. La demo volvió a cero al reabrir; no se creó una ficha ni se tocó un mundo. El gesto de equipo Primary/Secondary fue un contraste separado. `BRAVE-RED.md` registra Writer anterior (`8a9c5cc7`) con Hope, PV, estrés y armadura, pero sin oro en Partida.

Los recibos están en `Research/writer-parity-20261110/daggerheart-gold/`. `COMMIT-CUT3044-r1.json` (SHA-256 `32ef799f023a7aa86e7370f9753c9b14c8aeb1db0edb4c1e798361016b8860ad`) registra siete rutas y siete hashes del candidato `965470d074d910c4fcff5372435ee1100e00cb24` sobre `305e349a1eaf2d1727ca49e6d7ce5595ab2d65fc`.

- `BRAVE-GREEN.md`: el candidato marcó 3/2/1 y redujo puñados a dos al pulsar el extremo. Base guardó 2/2/1; Later heredó esos valores, guardó 7/2/1 y reabrió en frío. Base reabrió 2/2/1. El adversario Rival no mostró Oro. Se verificaron las etiquetas castellanas en Partida y Papel. El primer intento con una ficha sembrada directamente causó conflicto de revisión; se retiró y se repitió con creación normal. Limpieza: 89 tablas de prueba vacías y pestaña cerrada.
- `CONTRACT.log`: PASS para validación, cero en ficha antigua sin escritura, Papel y coordenadas de tinta, JSON, Base/era y revisión obsoleta. Rechaza un JSON parcial y oro en adversarios. El Papel antiguo no gana una sección por abrirlo.
- `native3044/run-20261112T062837Z-037700de/RESULT.json`: dos claves, diez llamadas MCP y un Deshacer, once respuestas IPC. A leyó 0/0/0 sin campo guardado; B escribió puñados y bolsas en Base, y cofre en la era. JSON de la era reflejó 3/2/1; Deshacer devolvió 3/2/0 y el renderer quedó acorde con Base. SHA-256 del resultado `783ccb896f21acbf8d7870e3dd2da0fd1989b1e34c6471eaac7aa9c08c79e162`. El recibo `NATIVE-RETIRE3044-run-20261112T062837Z-037700de.json` confirma puerto cerrado y perfil retirado.
- `SUITES.json`: Quick y Build terminaron con código 0. `QUICK.log` registra 34 motores, 64 tablas de motores y cero advertencias conocidas de conformidad; `BUILD.log`, compilación de producción en 2m 19s. `DETECT.json` registra `[]`.
- `CAS3044-r1.json`, `MERGE3044-RESULT-r1.json`, `RETIRE3044-FINAL-r1.json` y `DONE3044-r1.json`: revisión independiente r1 del commit exacto, integración por fast-forward, retirada normal del worktree y la rama de Source, y cierre de #3044.
- `MANUAL3044-r1.json`: se verificó la incorporación de 207 caracteres sobre Partida, Papel y valores por era. Se conservaron 895 párrafos y 79 listas.

## Conversión al completar diez (#3049)

Los recibos están en `Research/writer-parity-20261110/daggerheart-gold-carry3049/`. `COMMIT-CUT3049-r1.json` (SHA-256 `bde079569f072651c9802ea33d6872d1014e0b1029a3086e9181d805f74c1578`) registra cuatro rutas y siete hashes del candidato `4844af19eea9e21e6bebd68e889b9b068bb7d838` sobre `03c3bd155988b23eefd470c738ef5a335d1eb0ff`.

- `REFERENCE.md` y `BRAVE-RED.md`: VVD 0.1.9 convirtió el décimo puñado en bolsa y encadenó el acarreo a cofre con nueve bolsas ya confirmadas. Con el cofre marcado, la décima bolsa dejó cero bolsas. Writer #3044 mantuvo 10/0/0 al pulsar el décimo puñado. `CONTRACT-RED.log` reprodujo el fallo de esa conversión.
- `BRAVE-GREEN.md`: Writer convirtió un 10/0/0 previo a 0/1/0 al volver a pulsar el diez. Desde 0/9/0, el décimo puñado produjo 0/0/1. Con el cofre ocupado conservó 0/10/1, y con bolsas y cofre llenos conservó 10/10/1. Al quitar el cofre y volver a pulsar el décimo puñado, quedaron 0/1/1. Base guardó ese valor. Later lo heredó, guardó 0/10/1 y lo conservó al reabrir en frío. Base conservó 0/1/1. Se comprobó el aviso en Partida, se retiró la ficha de prueba y quedaron 89 tablas vacías.
- `CONTRACT.log`: PASS para acarreo, destino lleno, fichas antiguas, validación, Papel y coordenadas de tinta, JSON, Base/era y revisión obsoleta.
- `native3049/run-20261112T064129Z-8e2e307c/RESULT.json`: dos claves, once llamadas MCP y un Deshacer, doce respuestas IPC. La era heredó 0/9/0 de Base y convirtió a 0/0/1 sin modificar Base. Conservó 0/10/1 con el cofre lleno y Deshacer restauró 0/0/1. La escritura posterior en Base convirtió de forma independiente y el renderer mostró 0/0/1. Ambas claves devolvieron 401 tras revocarse, sin IPC. SHA-256 del resultado `cb95f825c0e385f06d2603d3425e5120c648bda1bbdfd643e03b94a634df261a`. `NATIVE-RETIRE3049-run-20261112T064129Z-8e2e307c.json` confirma puerto cerrado, perfil retirado y cero procesos propios.

- `SUITES.json` y `REGRESSION.json`: Quick, Build y las pruebas de regresión de profundidad y adversarios terminaron con código 0.
- `CAS3049-r1.json`, `MERGE3049-RESULT-r1.json` y `RETIRE3049-FINAL-r1.json`: revisión independiente r1 del commit exacto, integración por fast-forward de cuatro rutas y retirada normal del worktree y la rama de Source.
- `MANUAL3049-r1.json`: se verificó la incorporación de 220 caracteres sobre conversión, conservación del oro y reintento. Se conservaron 895 párrafos y 79 listas.

El modo de monedas contadas y los cambios de equipo quedan fuera de ambos cortes.
