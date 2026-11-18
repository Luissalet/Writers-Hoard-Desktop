import type { BridgeTool } from '@/services/aiBridge/schema';

export const WEATHER_DATE_SCHEMA = { type: 'object', properties: { year: { type: 'integer' }, month: { type: 'integer', minimum: 1 }, day: { type: 'integer', minimum: 1 } }, required: ['year', 'month', 'day'], additionalProperties: false };
const properties = { worldId: { type: 'string' }, key: { type: 'string', description: 'An atlas place key; give key or x,y.' }, x: { type: 'number' }, y: { type: 'number' }, date: WEATHER_DATE_SCHEMA };
export const WORLD_WEATHER_TOOLS: BridgeTool[] = [
  { name: 'wh_get_world_weather', writes: false,
    description: 'Read seeded daily weather, sunrise, sunset, every moon and night light at a world point and exact date.\nUses the project or inherited saga calendar, including leap days and day length. Local solar hours, fixed Earthlike tilt; a fictional model over existing climate, elevation and currents. Give an atlas key or x,y. Unbuilt worlds return pending. Partial and approximate dates are refused.',
    schema: { type: 'object', properties, required: ['worldId', 'date'], additionalProperties: false } },
  { name: 'wh_describe_world_presence', writes: false,
    description: 'Read terrain, vegetation, materials, diet, language ancestry, nearby places, trade and dated weather.\nExtends the existing atlas place card. Materials and food are derived possibilities, not authored culture. Language uses existing realm/culture assignments; markets use the existing economy and authored trade sites. No nearby market or known language returns null. Nearby radius is 150 km. Date is optional; weather needs an exact project-calendar date.',
    schema: { type: 'object', properties, required: ['worldId'], additionalProperties: false } },
];
