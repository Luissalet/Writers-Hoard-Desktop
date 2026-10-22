export const mapScaleCopy = {
  es: {
    panel: 'Escala y medidas', widthKm: 'Anchura del mapa (km, de borde a borde)', setScale: 'Fijar escala', clearScale: 'Quitar escala',
    noScale: 'Sin escala: fija la anchura o mide una distancia que conozcas.', scaleIs: 'Escala: {km} de borde a borde',
    measure: 'Medir', stopMeasure: 'Terminar de medir', measureHelp: 'Haz clic en el mapa para marcar puntos; la distancia se suma tramo a tramo.',
    clearMeasure: 'Borrar medida', measured: 'Distancia medida', knownIs: 'Esta distancia son', calibrate: 'Fijar escala con ella',
    needTwo: 'Marca al menos dos puntos.', travel: 'De viaje',
    realPlace: 'Lugar real a la misma escala', realNone: 'Ninguno', realSize: '{w} × {h}', realHelp: 'Arrastra la silueta para moverla.', realNeedsScale: 'Fija una escala para comparar con lugares reales.',
    key: 'Pegar la leyenda del mapa', keyHelp: 'Una línea por lugar: «A. El viejo molino», «B) Posada del cruce», «3 - Atalaya». Nombra los marcadores que se llaman sólo con esa letra o número.',
    keyPreview: 'Comprobar', keyApply: 'Nombrar {n} marcadores', keyNone: 'Ningún marcador se llama con esas letras o números.', keyUnmatched: 'Sin marcador: {list}', keyDone: '{n} marcadores nombrados',
    length: 'Longitud', perimeter: 'Perímetro', area: 'Superficie', pathStyle: 'Trazo', pathPlain: 'Ruta', pathRoad: 'Camino', pathTrail: 'Senda', pathRiver: 'Río', linePattern: 'Dibujo de la línea', lineByStyle: 'Según el trazo', lineSolid: 'Continua', lineDashed: 'Discontinua', lineDotted: 'Punteada',
    failed: 'No se pudo guardar.', scaleBar: 'Barra de escala',
  },
  en: {
    panel: 'Scale and measuring', widthKm: 'Map width (km, edge to edge)', setScale: 'Set scale', clearScale: 'Remove scale',
    noScale: 'No scale yet: set the width or measure a distance you know.', scaleIs: 'Scale: {km} edge to edge',
    measure: 'Measure', stopMeasure: 'Stop measuring', measureHelp: 'Click the map to mark points; the distance adds up leg by leg.',
    clearMeasure: 'Clear', measured: 'Measured distance', knownIs: 'This distance is', calibrate: 'Set the scale from it',
    needTwo: 'Mark at least two points.', travel: 'Travelling',
    realPlace: 'A real place at the same scale', realNone: 'None', realSize: '{w} × {h}', realHelp: 'Drag the outline to move it.', realNeedsScale: 'Set a scale to compare with real places.',
    key: 'Paste the map key', keyHelp: 'One line per place: "A. The Old Mill", "B) Crossroads Inn", "3 - Watchtower". Names the pins called only by that letter or number.',
    keyPreview: 'Check', keyApply: 'Name {n} pins', keyNone: 'No pin is called by those letters or numbers.', keyUnmatched: 'No pin for: {list}', keyDone: '{n} pins named',
    length: 'Length', perimeter: 'Perimeter', area: 'Area', pathStyle: 'Line', pathPlain: 'Route', pathRoad: 'Road', pathTrail: 'Trail', pathRiver: 'River', linePattern: 'Line pattern', lineByStyle: 'As the line', lineSolid: 'Solid', lineDashed: 'Dashed', lineDotted: 'Dotted',
    failed: 'Could not be saved.', scaleBar: 'Scale bar',
  },
};
export type MapScaleCopy = typeof mapScaleCopy.es;
