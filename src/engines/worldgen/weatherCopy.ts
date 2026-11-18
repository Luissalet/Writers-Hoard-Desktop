import type { WorldWeather as Weather } from './core/weather';
export const weatherEn = {
  title: 'Being there', date: 'Date in the world', dateHint: 'Choose an exact date to see the weather and sky.', calendarHint: 'Define a world calendar in Timeline to read dated weather.',
  weather: 'Weather and sky', clear: 'Clear', rain: 'Rain', snow: 'Snow', thunder: 'Thunderstorm', fog: 'Fog', frost: 'Frost', heat: 'Heat', gale: 'Gale',
  wind: 'Wind', clouds: 'Cloud cover', precipitation: 'Precipitation', sunrise: 'Sunrise', sunset: 'Sunset', daylight: 'Daylight', nightLight: 'Night light',
  polarDay: 'Polar day', polarNight: 'Polar night', noMoons: 'No moons in this calendar', localHours: 'Local solar hours',
  ground: 'Visible terrain and vegetation', materials: 'Building materials', diet: 'Local food sources', language: 'Spoken language', trade: 'Nearby market', nearby: 'Nearby settlements and ruins',
  unknown: 'No recorded local language', noneNearby: 'No recorded settlements or ruins within 150 km', noMarket: 'No recorded market within 150 km', noResources: 'No local source in this model',
  inference: 'Materials and food are possibilities derived from the ground. Culture and markets use the world’s existing records.',
  weatherModel: 'Seeded fictional weather. Seasons follow the world calendar, with a fixed axial tilt.',
  plain: 'Lowland', hills: 'Hills', mountains: 'Mountains', water: 'Water',
  volcanic: 'Volcanic rock', limestone: 'Limestone', sediment: 'Sedimentary ground', bedrock: 'Exposed bedrock',
  timber: 'Timber', stone: 'Stone', clay: 'Clay', reeds: 'Reeds', earth: 'Earth', grain: 'Grain', fish: 'Fish', meat: 'Meat and dairy', gathering: 'Forest gathering',
  wool: 'Wool', iron: 'Iron', salt: 'Salt', produces: 'Produces', price: 'Price index', settlement: 'Settlement', ruin: 'Ruin',
  new: 'New moon', waxingCrescent: 'Waxing crescent', firstQuarter: 'First quarter', waxingGibbous: 'Waxing gibbous', full: 'Full moon', waningGibbous: 'Waning gibbous', lastQuarter: 'Last quarter', waningCrescent: 'Waning crescent',
  weatherTravel: 'Apply dated weather to journey duration', weatherTravelHint: 'Uses daily conditions along this itinerary. The path stays the same.', delay: 'Weather delay', departure: 'Departure date',
  chapter: 'Scene place and weather', noPlace: 'Link a place to this chapter from the map to read its surroundings.', undated: 'Add an exact chapter date for weather and moons.', loading: 'Reading the world…', pending: 'The world is being prepared. Try again shortly.', retry: 'Retry', failed: 'Could not read this place. Try again.',
};
export const weatherEs: typeof weatherEn = {
  title: 'Estar allí', date: 'Fecha del mundo', dateHint: 'Elige una fecha exacta para ver el tiempo y el cielo.', calendarHint: 'Define un calendario del mundo en Línea temporal para consultar el tiempo por fecha.',
  weather: 'Tiempo y cielo', clear: 'Despejado', rain: 'Lluvia', snow: 'Nieve', thunder: 'Tormenta', fog: 'Niebla', frost: 'Helada', heat: 'Calor intenso', gale: 'Vendaval',
  wind: 'Viento', clouds: 'Nubes', precipitation: 'Precipitación', sunrise: 'Salida del sol', sunset: 'Puesta del sol', daylight: 'Horas de luz', nightLight: 'Luz nocturna',
  polarDay: 'Día polar', polarNight: 'Noche polar', noMoons: 'Este calendario no tiene lunas', localHours: 'Horas solares locales',
  ground: 'Relieve y vegetación a la vista', materials: 'Materiales de construcción', diet: 'Alimentos del entorno', language: 'Lengua que se habla', trade: 'Mercado cercano', nearby: 'Asentamientos y ruinas cercanos',
  unknown: 'No consta una lengua local', noneNearby: 'No constan asentamientos ni ruinas a menos de 150 km', noMarket: 'No consta un mercado a menos de 150 km', noResources: 'Sin fuente local en este modelo',
  inference: 'Los materiales y alimentos son posibilidades derivadas del terreno. La cultura y el mercado proceden de los datos del mundo.',
  weatherModel: 'Tiempo ficticio desde la semilla. Las estaciones siguen el calendario del mundo y la inclinación del eje es fija.',
  plain: 'Llanura', hills: 'Colinas', mountains: 'Montañas', water: 'Agua',
  volcanic: 'Roca volcánica', limestone: 'Caliza', sediment: 'Suelo sedimentario', bedrock: 'Roca expuesta',
  timber: 'Madera', stone: 'Piedra', clay: 'Arcilla', reeds: 'Cañas', earth: 'Tierra', grain: 'Cereales', fish: 'Pescado', meat: 'Carne y lácteos', gathering: 'Recolección del bosque',
  wool: 'Lana', iron: 'Hierro', salt: 'Sal', produces: 'Produce', price: 'Índice de precio', settlement: 'Asentamiento', ruin: 'Ruina',
  new: 'Luna nueva', waxingCrescent: 'Creciente', firstQuarter: 'Cuarto creciente', waxingGibbous: 'Gibosa creciente', full: 'Luna llena', waningGibbous: 'Gibosa menguante', lastQuarter: 'Cuarto menguante', waningCrescent: 'Menguante',
  weatherTravel: 'Aplicar el tiempo de la fecha a la duración del viaje', weatherTravelHint: 'Usa las condiciones diarias del recorrido. Conserva el itinerario.', delay: 'Retraso por el tiempo', departure: 'Fecha de partida',
  chapter: 'Lugar y tiempo de la escena', noPlace: 'Vincula un lugar a este capítulo desde el mapa para consultar su entorno.', undated: 'Añade una fecha exacta al capítulo para ver el tiempo y las lunas.', loading: 'Leyendo el mundo…', pending: 'Se está preparando el mundo. Vuelve a consultar en unos instantes.', retry: 'Reintentar', failed: 'No se pudo leer el lugar. Vuelve a intentarlo.',
};
export function weatherCopy(locale: string) { return locale === 'en' ? weatherEn : weatherEs; }

export function weatherSummary(weather: Weather, locale: string) {
  const copy = weatherCopy(locale);
  return `${Math.round(weather.temperatureC)} °C · ${weather.phenomena.map(p => copy[p]).join(', ') || copy.clear}`;
}
