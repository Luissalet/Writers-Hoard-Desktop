// =====================================================
// Plegar texto para buscarlo — sin tildes y sin eñes
// =====================================================
// Vive fuera del panel que lo usa por dos razones, y la segunda es la que
// manda: (1) el Índice del atlas tendrá que buscar igual el día que se le pida,
// y dos búsquedas que ordenan distinto en la misma aplicación es un fallo con
// dos sitios donde arreglarlo; y (2) DENTRO de un `.tsx` esto no se puede
// medir sin montar React, y lo que no se puede medir se rompe sin que nadie se
// entere. El banco es `harness/screen-navigation.ts`.

/**
 * Sin tildes, sin mayúsculas, sin eñe.
 *
 * `NFD` parte «í» en «i» + tilde combinante, y el rango U+0300-U+036F barre
 * todas las combinantes: «ñ» cae en «n» y «ü» en «u», que es lo que el lector
 * teclea cuando no se acuerda del acento (o cuando escribe deprisa). La misma
 * operación TIENE que aplicarse a los dos lados: plegar sólo la consulta deja
 * «Río» tan inalcanzable como estaba.
 *
 * Importa más de lo que parece en este motor: 9 de las 94 plantillas de nombre
 * de `core/naming.ts` llevan tilde, y no están repartidas al azar — son 2 de
 * las 4 del RÍO («Río {n}») y 2 de las 4 del OCÉANO. Sin plegar, «rio» no
 * encontraba la mitad de los ríos con nombre del mundo.
 */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

/**
 * Cómo de bien encaja lo tecleado en un nombre ya plegado.
 *
 * Menor es mejor; -1 es que no encaja. Que empiece una PALABRA vale casi tanto
 * como que empiece el nombre, porque media toponimia del motor es «Río X»,
 * «Monte Y», «Bahía de Z» y teclear el apellido es la forma natural de
 * buscarlos. Ordenar sólo por importancia —lo que se hacía— dejaba la aldea
 * cuyo nombre tecleaste ENTERO por debajo de la capital que lo contiene dentro.
 */
export function matchRank(folded: string, foldedQuery: string): number {
  const i = folded.indexOf(foldedQuery);
  if (i < 0) return -1;
  if (i === 0) return 0;
  return folded[i - 1] === ' ' ? 1 : 2;
}
